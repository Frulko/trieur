// Jeu de démonstration : des liens à ranger dans six dossiers.
//
// `folder` est la « vérité » — le dossier où l'utilisateur fictif range effectivement ce
// lien. Les démos ne s'en servent que pour rejouer un tri automatiquement et montrer la
// justesse du modèle monter ; en usage normal, c'est le geste de l'utilisateur qui décide,
// et le modèle n'a évidemment accès à rien de tel.

export interface Lien {
  id: number;
  host: string;
  title: string;
  excerpt: string;
  tags: string[];
  folder: string;
}

export const zones = [
  { id: 'dev', label: 'dev', icon: '⌘', color: '#4a54f2' },
  { id: 'ia', label: 'ia', icon: '◑', color: '#8b5cf6' },
  { id: 'design', label: 'design', icon: '◈', color: '#ec4899' },
  { id: 'maison', label: 'maison', icon: '⌂', color: '#f59e0b' },
  { id: 'veille', label: 'veille', icon: '◎', color: '#10b981' },
  { id: 'à lire', label: 'à lire', icon: '▤', color: '#64748b' },
];

const raw: Array<[string, string, string, string[], string]> = [
  ['github.com', 'tokio-rs/axum', 'Framework web ergonomique et modulaire pour Rust', ['rust', 'web', 'async'], 'dev'],
  ['github.com', 'oven-sh/bun', 'Runtime JavaScript tout-en-un écrit en Zig', ['javascript', 'runtime', 'zig'], 'dev'],
  ['github.com', 'sqlite/sqlite', 'Le moteur de base de données embarqué le plus déployé', ['sqlite', 'c', 'database'], 'dev'],
  ['github.com', 'BurntSushi/ripgrep', 'Recherche récursive orientée ligne, très rapide', ['rust', 'cli', 'search'], 'dev'],
  ['github.com', 'sharkdp/fd', 'Alternative simple et rapide à find', ['rust', 'cli'], 'dev'],
  ['github.com', 'astral-sh/uv', 'Gestionnaire de paquets Python en Rust', ['rust', 'python', 'packaging'], 'dev'],
  ['github.com', 'microsoft/TypeScript', 'JavaScript typé qui compile en JavaScript', ['typescript', 'compiler'], 'dev'],
  ['github.com', 'vitejs/vite', 'Outillage front nouvelle génération', ['javascript', 'build', 'web'], 'dev'],
  ['news.ycombinator.com', 'SQLite is not a toy database', 'Pourquoi SQLite tient en production plus souvent qu’on ne croit', ['sqlite', 'database'], 'dev'],
  ['news.ycombinator.com', 'The case for monorepos', 'Retour d’expérience après six ans de dépôt unique', ['monorepo', 'process'], 'dev'],
  ['developer.mozilla.org', 'Pointer events', 'Un seul modèle d’événements pour souris, doigt et stylet', ['web', 'javascript', 'api'], 'dev'],
  ['developer.mozilla.org', 'IndexedDB API', 'Base de données transactionnelle côté navigateur', ['web', 'storage', 'api'], 'dev'],
  ['developer.mozilla.org', 'CSS color-mix()', 'Mélanger deux couleurs directement en CSS', ['css', 'web'], 'design'],

  ['arxiv.org', 'Attention Is All You Need', 'L’architecture transformer, sans récurrence ni convolution', ['ml', 'transformer', 'nlp'], 'ia'],
  ['arxiv.org', 'Online Learning and Online Convex Optimization', 'Panorama des garanties de regret en apprentissage en ligne', ['ml', 'online', 'theory'], 'ia'],
  ['arxiv.org', 'Adaptive Subgradient Methods', 'AdaGrad : un pas par coordonnée, réglé tout seul', ['ml', 'optimisation'], 'ia'],
  ['arxiv.org', 'A Few Useful Things to Know About Machine Learning', 'Les pièges classiques, expliqués sans formalisme', ['ml', 'pratique'], 'ia'],
  ['huggingface.co', 'sentence-transformers/all-MiniLM-L6-v2', 'Petit modèle d’embeddings de phrases', ['ml', 'embeddings', 'nlp'], 'ia'],
  ['huggingface.co', 'Text Embeddings Inference', 'Serveur d’inférence dédié aux embeddings', ['ml', 'embeddings', 'serveur'], 'ia'],
  ['distill.pub', 'Why Momentum Really Works', 'Le momentum expliqué visuellement', ['ml', 'optimisation', 'viz'], 'ia'],
  ['github.com', 'ggml-org/llama.cpp', 'Inférence de modèles de langage en C/C++', ['ml', 'inference', 'cpp'], 'ia'],
  ['github.com', 'facebookresearch/faiss', 'Recherche de similarité sur des vecteurs denses', ['ml', 'embeddings', 'index'], 'ia'],

  ['figma.com', 'Variables et modes', 'Thématiser un système de composants sans dupliquer', ['design', 'figma', 'tokens'], 'design'],
  ['practicaltypography.com', 'Typewriter habits', 'Les réflexes de la machine à écrire à désapprendre', ['typographie', 'design'], 'design'],
  ['ia.net', 'The 100% Easy-2-Read Standard', 'Régler la lisibilité d’un texte long', ['typographie', 'design', 'lecture'], 'design'],
  ['refactoringui.com', 'Establish a spacing system', 'Une échelle d’espacement plutôt que des pixels au jugé', ['design', 'ui', 'système'], 'design'],
  ['fonts.google.com', 'Inter', 'Fonte pensée pour les interfaces à l’écran', ['typographie', 'design', 'fonte'], 'design'],
  ['lawsofux.com', 'Fitts’s Law', 'Le temps pour atteindre une cible dépend de sa taille et de sa distance', ['ux', 'design', 'théorie'], 'design'],
  ['cassie.codes', 'Animating SVG paths', 'Le dessin de trait, sans bibliothèque', ['svg', 'animation', 'web'], 'design'],

  ['ikea.com', 'PAX planificateur', 'Composer un dressing sur mesure', ['meuble', 'rangement', 'maison'], 'maison'],
  ['leroymerlin.fr', 'Poser une étagère murale', 'Chevilles, niveau, entraxe', ['bricolage', 'maison', 'tuto'], 'maison'],
  ['marmiton.org', 'Pain au levain naturel', 'Autolyse, pointage, apprêt', ['cuisine', 'pain', 'recette'], 'maison'],
  ['marmiton.org', 'Ragoût de légumes d’hiver', 'Une cocotte, deux heures, rien à surveiller', ['cuisine', 'recette'], 'maison'],
  ['cuisine-az.com', 'Confiture de figues', 'Proportions et temps de cuisson', ['cuisine', 'recette', 'conserve'], 'maison'],
  ['youtube.com', 'Affûter un couteau à la pierre', 'Angle, pression, entretien', ['cuisine', 'outil', 'tuto'], 'maison'],
  ['youtube.com', 'Réparer une chasse d’eau', 'Diagnostic et pièces courantes', ['bricolage', 'plomberie', 'tuto'], 'maison'],
  ['jardinage.ooreka.fr', 'Tailler un pommier', 'Quand, où, et surtout pourquoi', ['jardin', 'taille', 'maison'], 'maison'],

  ['x.com', '@simonw sur les modèles locaux', 'Fil sur ce qui tourne vraiment sur un portable', ['ml', 'local', 'fil'], 'veille'],
  ['x.com', '@dan_abramov sur les server components', 'Fil qui reprend le modèle mental depuis le début', ['react', 'web', 'fil'], 'veille'],
  ['x.com', '@jaffathecake sur les transitions de vue', 'Démonstration en trois messages', ['web', 'css', 'fil'], 'veille'],
  ['reddit.com', 'r/rust — retours après un an en production', 'Ce qui a bien vieilli et ce qui a coûté cher', ['rust', 'retour', 'production'], 'veille'],
  ['reddit.com', 'r/selfhosted — sauvegardes qui tiennent', 'Stratégies 3-2-1 réellement appliquées', ['selfhosting', 'backup'], 'veille'],
  ['lobste.rs', 'Écrire un moteur de recherche en un week-end', 'BM25 de bout en bout, sans bibliothèque', ['search', 'bm25', 'projet'], 'veille'],
  ['changelog.com', 'Le podcast des mainteneurs', 'Épisode sur l’épuisement en open source', ['opensource', 'podcast'], 'veille'],

  ['medium.com', '@handle — Naive Bayes, vraiment naïf ?', 'Ce que l’hypothèse d’indépendance coûte en pratique', ['ml', 'bayes', 'article'], 'à lire'],
  ['medium.com', '@handle — Vingt ans de systèmes de recommandation', 'Du filtrage collaboratif aux embeddings', ['ml', 'reco', 'article'], 'à lire'],
  ['substack.com', 'La lettre du vendredi', 'Long format sur l’attention et les interfaces', ['essai', 'lecture'], 'à lire'],
  ['newyorker.com', 'The art of decision fatigue', 'Pourquoi trier épuise plus que choisir', ['essai', 'psycho', 'lecture'], 'à lire'],
  ['nature.com', 'Sur la mémoire des gestes', 'Ce que la répétition inscrit et ce qu’elle efface', ['science', 'lecture'], 'à lire'],
  ['longform.org', 'Une année sans notifications', 'Récit d’une expérience de douze mois', ['essai', 'attention', 'lecture'], 'à lire'],
];

export const liens: Lien[] = raw.map(([host, title, excerpt, tags, folder], id) => ({
  id,
  host,
  title,
  excerpt,
  tags,
  folder,
}));

/** Ce que le modèle regarde. C'est l'hôte qui décide — la lib ne connaît pas ces champs. */
export const meta = (l: Lien) => ({ domain: l.host, tag: l.tags, title: l.title });

/** Mélange déterministe : la démo est la même à chaque visite. */
export function shuffled(seed = 11): Lien[] {
  const out = [...liens];
  let a = seed;
  for (let i = out.length - 1; i > 0; i--) {
    a = (a * 1664525 + 1013904223) >>> 0;
    const j = a % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
