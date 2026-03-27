# GitHub Setup

## Create a repository

From inside this folder, run:

```bash
git init
git add .
git commit -m "Initial Cenozoic fauna database"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

## What should stay together

These paths should remain in the same repository:

- `README.md`
- `GITHUB_SETUP.md`
- `data/`
- `scripts/`

The generated JSON and JS bundles are already included, so the repository is immediately usable as a data source even before you rerun the builder.

## Notes

- The publishable data is split into `data/chunks/` so each file stays below browser-upload limits on GitHub.
- `data/raw/` is treated as a local cache and should not be committed.
- Git LFS is not required for this chunked snapshot.
