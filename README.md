# ZeynFreelance

QG de prospection de ZeynFreelance (création de sites web pour les commerces de Béziers) : PWA pour PC et iPhone.

- **Aujourd'hui** : actions du jour, relances en retard, priorités, objectifs, prompt « coach du jour »
- **IA** : prompts ChatGPT prêts à copier (trouver des commerces / analyser des notes en vrac), réponse JSON collée → fiches créées automatiquement
- **Prospects** : fiches triées par score de pertinence (/100), filtres, pipeline de statuts, prompt de mini-audit par commerce
- **Carte** : commerces géolocalisés (OpenStreetMap), couleur = statut, taille = score
- **Business** : clients (acompte, solde, maintenance) et finances (capital, dépenses, bénéfice, URSSAF à provisionner)

Stack : HTML/CSS/JS sans build, Supabase (tables `zf_*` dans le projet Blourr, RLS limitée au compte admin), Leaflet, GitHub Pages.
