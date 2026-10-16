# Snelle ontwikkelworkflow

Gebruik tijdens kleine aanpassingen:

```bash
npm run verify:fast
```

Deze controle gebruikt TypeScripts incrementele cache. De eerste uitvoering
controleert het hele project; volgende uitvoeringen controleren vooral wat is
gewijzigd. Voer voor iedere release altijd ook uit:

```bash
npm run build
```

De volledige build blijft de eindcontrole. Hij gebruikt eveneens een
persistente Turbopack-cache, maar slaat geen typecontrole of productiestap over.

## Werkmap

Werk bij voorkeur vanuit een lokale Git-worktree buiten Dropbox. De Dropbox-map
blijft de bron/opslaglocatie, maar bestandssynchronisatie van `.git`, `.next` en
`node_modules` kan Git en builds tientallen seconden blokkeren. Een lokale
worktree verandert niets aan de repositorygeschiedenis en kan gewoon naar
dezelfde `origin` pushen.
