# Publish the latest local commit to GitHub through the REST Git Data API, using the signed-in `gh` CLI.
# Fallback for networks where `git push` is blocked (it fails with HTTP 503 here) but the GitHub API works.
#
#   npm run deploy:api                # this repo, branch main
#   python3 -I scripts/deploy/api_push.py [owner/repo] [branch]
#
# Safety: refuses to run with uncommitted changes, and refuses if GitHub has commits that your
# local branch doesn't (it never overwrites remote work). Afterwards the local branch is re-synced
# to the commit GitHub created. Only HEAD's message is used; commit locally first.
import base64, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

repo_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
def _sh(*a): return subprocess.run(a, capture_output=True, text=True, cwd=repo_dir)
repo = sys.argv[1] if len(sys.argv) > 1 else _sh('gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner').stdout.strip()
branch = sys.argv[2] if len(sys.argv) > 2 else 'main'
if not repo: sys.exit('Could not determine the GitHub repo; pass owner/repo as the first argument.')
if _sh('git', 'status', '--porcelain').stdout.strip(): sys.exit('Uncommitted changes — commit (or stash) them first.')

def gh(method, url, body=None):
    for i in range(5):
        p = subprocess.run(['gh', 'api', '-X', method, f'/repos/{repo}{url}'] + (['--input', '-'] if body is not None else []),
                           input=json.dumps(body).encode() if body is not None else None, capture_output=True)
        if p.returncode == 0:
            return json.loads(p.stdout or b'{}')
        err = p.stderr.decode()
        if 'HTTP 5' in err or 'HTTP 429' in err or 'timeout' in err.lower():
            time.sleep(2 * (i + 1)); continue
        raise RuntimeError(f'{method} {url}: {err.strip()[:300]}')
    raise RuntimeError(f'{method} {url}: retries exhausted')

def git(*a):
    return subprocess.run(['git', '-C', repo_dir, *a], capture_output=True, check=True).stdout.decode()

try:
    parent = gh('GET', f'/git/ref/heads/{branch}')['object']['sha']
    local_parent = _sh('git', 'rev-parse', 'HEAD~1').stdout.strip()
    if local_parent != parent:
        sys.exit(f'GitHub {branch} is at {parent[:7]} but your commit sits on {local_parent[:7]}. '
                 f'Run: git fetch origin && git rebase origin/{branch} (or reset --soft), then retry.')
except RuntimeError:
    gh('PUT', '/contents/.gitkeep-init', {'message': 'Initialize repository', 'content': '', 'branch': branch})
    parent = gh('GET', f'/git/ref/heads/{branch}')['object']['sha']

files = []
for line in git('ls-files', '-s').strip().split('\n'):
    meta, path = line.split('\t'); files.append((meta.split(' ')[0], path))
print(f'uploading {len(files)} files…', flush=True)

def up(f):
    mode, path = f
    with open(os.path.join(repo_dir, path), 'rb') as fh:
        sha = gh('POST', '/git/blobs', {'content': base64.b64encode(fh.read()).decode(), 'encoding': 'base64'})['sha']
    return {'path': path, 'mode': mode, 'type': 'blob', 'sha': sha}

with ThreadPoolExecutor(6) as ex:
    tree = list(ex.map(up, files))
t = gh('POST', '/git/trees', {'tree': tree})
message = git('log', '-1', '--format=%B').strip()
author = {'name': git('log', '-1', '--format=%an').strip(), 'email': git('log', '-1', '--format=%ae').strip()}
c = gh('POST', '/git/commits', {'message': message, 'tree': t['sha'], 'parents': [parent], 'author': author})
gh('PATCH', f'/git/refs/heads/{branch}', {'sha': c['sha'], 'force': False})
print('pushed commit', c['sha'])
# re-sync: make local history match the commit GitHub created (same tree, so no file changes)
_sh('git', 'fetch', '-q', 'origin'); _sh('git', 'reset', '-q', '--soft', f'origin/{branch}')
print('local branch synced to', _sh('git', 'rev-parse', '--short', 'HEAD').stdout.strip())
