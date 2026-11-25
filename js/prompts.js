// Prompts à copier dans ChatGPT. Les réponses doivent être collées dans l'app (format JSON).

const SCHEMA = `{
  "conseil_global": "string — 2 à 4 phrases : par qui commencer et pourquoi",
  "commerces": [
    {
      "nom": "string",
      "metier": "string (ex : barbier, snack, coiffeur, boulangerie)",
      "quartier": "string ou null (quartier / secteur de Béziers)",
      "adresse": "string ou null (numéro, rue, code postal, ville)",
      "telephone": "string ou null",
      "email": "string ou null",
      "gerant": "string ou null",
      "site_web": "string ou null (URL actuelle, Facebook, Instagram, Planity...)",
      "etat_site": "none | bad | social | ok",
      "reservation_en_ligne": true,
      "note_google": 4.5,
      "nb_avis_google": 120,
      "lien_google_maps": "string ou null",
      "sources": ["URL où tu as trouvé les infos"],
      "problemes": ["ce qui ne va pas dans leur présence en ligne"],
      "ameliorations": ["ce que je peux leur proposer concrètement"],
      "formule": "essentiel | pro | premium",
      "prix_estime": 500,
      "accroche": "1 phrase que je peux dire en entrant dans le commerce",
      "priorite": 1,
      "prochaine_action": "string — la première chose à faire avec ce commerce",
      "fiabilite": "haute | moyenne | faible (fiabilité des infos trouvées)"
    }
  ]
}`;

const RULES = `RÈGLES STRICTES :
- N'invente JAMAIS un numéro, une adresse, un mail ou une note. Si tu ne trouves pas l'info, mets null.
- etat_site : "none" = aucun site ; "social" = seulement Facebook/Instagram/Planity/annuaire ; "bad" = site obsolète, cassé, lent, non adapté au mobile ou sans infos utiles ; "ok" = bon site (à éviter, sauf si autre gros problème).
- formule : "essentiel" = site vitrine + fiche Google optimisée (400–600 €) ; "pro" = + menu en ligne/galerie/bouton de réservation (600–900 €) ; "premium" = vraie plateforme de rendez-vous ou application (900 € et +).
- priorite : 1 = à démarcher en premier, 5 = pas prioritaire. Privilégie les commerces actifs (beaucoup d'avis récents = ils ont des clients et peuvent payer) avec une présence en ligne faible.
- Pas de commerces dont l'activité principale est contraire à l'islam (bars, alcool, tabac/jeux d'argent, boucheries non halal mises en avant pour le porc, etc.).
- Réponds UNIQUEMENT avec un bloc de code JSON valide, sans aucun texte avant ou après, en respectant exactement ce format :`;

export function searchPrompt({ trades, zone, count, exclude }) {
  const ex = exclude.length
    ? `\nCommerces que je connais déjà (NE PAS les proposer) : ${exclude.join(', ')}.`
    : '';
  return `Tu es un expert en prospection commerciale locale pour une micro-entreprise de création de sites web à Béziers (34500, Hérault).

MISSION : utilise la recherche sur internet (Google Maps, PagesJaunes, Facebook, Instagram, Planity, sites web) pour trouver ${count} commerces de type « ${trades} » situés ${zone ? `dans le secteur « ${zone} » de Béziers` : 'à Béziers'}, qui n'ont PAS de vrai site web ou dont la présence en ligne est faible (infos difficiles à trouver, pas d'horaires clairs, pas de réservation en ligne, site obsolète...).${ex}

Pour chaque commerce, vérifie les informations sur plusieurs sources, analyse sa présence en ligne comme le ferait un client qui le cherche, et dis-moi concrètement quoi lui proposer. Classe-les du plus intéressant au moins intéressant à démarcher.

${RULES}

${SCHEMA}`;
}

export function notesPrompt(notes) {
  return `Tu es mon assistant de prospection pour ma micro-entreprise de création de sites web à Béziers (34500, Hérault).

Voici mes notes brutes, prises en vrac sur différents commerces (visites, observations, recherches) :
"""
${notes}
"""

MISSION :
1. Repère chaque commerce mentionné dans mes notes.
2. Complète les informations manquantes avec la recherche sur internet (adresse, téléphone, note Google, nombre d'avis, site actuel), sans rien inventer.
3. Analyse sa présence en ligne et dis-moi ce qui doit être fait, quelle formule proposer et à quel prix.
4. Dis-moi à qui je dois m'intéresser en priorité et pourquoi (champ "priorite" et "conseil_global").
5. Mets dans "prochaine_action" l'action concrète à faire pour chacun (ex : « Passer mardi vers 15h avec la démo barbier »).

${RULES}

${SCHEMA}`;
}

export function auditPrompt(p) {
  const lines = [
    `Nom : ${p.name}`,
    p.trade && `Métier : ${p.trade}`,
    p.address && `Adresse : ${p.address}`,
    p.website && `Présence actuelle : ${p.website}`,
    p.google_rating != null && `Note Google : ${p.google_rating} (${p.google_reviews ?? '?'} avis)`,
    p.problems && `Problèmes repérés : ${p.problems}`,
    p.notes && `Mes notes : ${p.notes}`,
  ].filter(Boolean).join('\n');
  return `Tu es consultant en visibilité en ligne pour les commerces locaux. Je vais démarcher ce commerce de Béziers pour lui vendre un site web :

${lines}

Fais une recherche sur internet sur ce commerce et ses 2-3 concurrents directs à Béziers, puis rédige en français :

1. MINI-AUDIT (5 à 8 points courts) : ce que voit un client qui le cherche sur Google aujourd'hui, comparé à ses concurrents (fiche Google, photos, horaires, avis et réponses aux avis, site, réservation, réseaux sociaux).
2. LES 3 ARGUMENTS les plus forts pour le convaincre, chiffrés si possible (ex : « votre concurrent X a 3 fois plus d'avis et un site avec réservation »).
3. MON SCRIPT DE VISITE de 30 secondes, naturel et honnête, sans promesse exagérée.
4. LES OBJECTIONS probables (« j'ai pas le temps », « c'est trop cher », « j'ai déjà Facebook ») et quoi répondre.
5. LA FORMULE à proposer (essentiel 400–600 € / pro 600–900 € / premium 900 € et +) et pourquoi.

Sois concret et court. N'invente aucun chiffre : si tu ne sais pas, dis-le.`;
}

export function dayPrompt(summary) {
  return `Tu es mon coach commercial. Je lance ma micro-entreprise de création de sites web pour les commerces de Béziers (je suis étudiant, j'ai quelques heures par jour). Voici l'état actuel de mon suivi :

${summary}

Dis-moi en 10 lignes maximum : sur quels commerces je dois me concentrer aujourd'hui, dans quel ordre, quoi leur dire, et la seule chose la plus importante à accomplir aujourd'hui.`;
}
