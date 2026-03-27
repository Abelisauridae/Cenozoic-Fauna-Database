# Cenozoic Fauna Database

Structured database of prehistoric Cenozoic vertebrates built from Paleobiology Database records.

This first pass is intentionally scoped to vertebrate fauna rather than all animals. It includes mammals, terror birds and other birds, reptiles, amphibians, and fishes from the Cenozoic window requested for this project.

## Open the atlas

Open `index.html` or publish the folder with GitHub Pages to use the interactive atlas UI.

## Current dataset coverage

- 16,530 prehistoric vertebrate species
- 16,494 species with mapped fossil coordinates
- 80,038 aggregated localities
- 82,099 filtered PBDB occurrences
- group coverage including mammals, terror birds, reptiles, amphibians, and fishes

## Scope

- Source taxon: `Vertebrata`
- Time window: `66.0 Ma` to `0.01 Ma` (10,000 years ago)
- Coverage goal: accepted species-level fossil vertebrates that overlap the target window
- Exclusions: extant species, form taxa, and ichnotaxa

Because PBDB interval filters work at named stratigraphic intervals, the generator queries `Danian` through `Holocene` and then applies a local numeric age filter so the retained records overlap the exact target window.

## Outputs

Running the builder writes:

- `data/cenozoic-fauna-database.json`
- `data/cenozoic-fauna-database.js`
- `data/chunks/`
- `data/world-land.json`
- `data/world-land.js`

The publishable repository uses a chunked layout so each committed file stays comfortably below browser-upload limits on GitHub. The top-level database files are an index plus chunk manifest, and the species records are split across `data/chunks/*.json`.

## Rebuild

If the raw cache already exists:

```bash
python3 scripts/build_cenozoic_fauna_data.py
```

If you want to refresh the raw PBDB cache first:

```bash
curl -Lsf -o data/raw/pbdb-cenozoic-vertebrate-taxa.csv 'https://paleobiodb.org/data1.2/taxa/list.csv?base_name=Vertebrata&rank=species&show=app,parent,size,class&interval=Danian,Holocene&limit=all'
curl -Lsf -o data/raw/pbdb-cenozoic-vertebrate-occurrences.csv 'https://paleobiodb.org/data1.2/occs/list.csv?base_name=Vertebrata&taxon_reso=species&show=coords,class,time&interval=Danian,Holocene&limit=all'
```

The builder will also fetch any missing raw files automatically, so `data/raw/` does not need to be committed.

## Dataset shape

Each species record includes:

- taxonomic fields
- a high-level fauna grouping
- a clamped Cenozoic temporal range
- PBDB occurrence metadata
- aggregated mapped localities
- a generated summary description

## Sources

- Paleobiology Database taxonomic names API
- Paleobiology Database fossil occurrences API
- Natural Earth 1:110m land polygons for future map backdrops

## Repository layout

- `data/` contains the generated index, chunk files, and map assets
- `data/chunks/` contains species chunks sized for GitHub-friendly commits and uploads
- `data/raw/` is an optional local cache and is intentionally excluded from version control
- `scripts/` contains the generator
- `GITHUB_SETUP.md` contains quick push instructions for a new repository
