---
layout: ../../layouts/Doc.astro
title: Dans une app
description: Mode léger et mode complet, stockage, hors ligne, et comment une app parle au modèle.
---

Une app ne manipule qu'un objet : le **recommandeur**. Il expose exactement ce que le deck
attend, plus de quoi afficher un état et de quoi ne rien perdre à la fermeture.

```ts
interface Recommender {
  best(meta, zones, minScore?): Promise<Prediction | null>;  // la zone si elle se détache
  suggest(meta, zones): Promise<Ranked[]>;                   // le classement complet
  record(r: SortRecord): Promise<void>;                      // un rangement a eu lieu
  forget(r: SortRecord): Promise<void>;                      // il est annulé
  stats(): Promise<Stats>;
  flush(): Promise<void>;                                    // écrire ce qui est en attente
}
```

Le deck appelle `best`, `record` et `forget` tout seul. Les autres méthodes servent à ton
interface.

## Mode léger

```js
const brain = createRecommender({ key: 'liens' });
deck.setOptions({ advisor: brain });
```

Tout reste dans le navigateur. Aucune donnée ne sort, aucune latence réseau, ça marche dans
l'avion. Pour beaucoup d'apps, c'est le seul mode nécessaire.

**Où vit le modèle.** `autoStore()` choisit IndexedDB si disponible, sinon `localStorage`,
sinon la mémoire. IndexedDB par défaut pour deux raisons : `localStorage` plafonne autour de
5 Mo, et surtout il est *synchrone* — chaque écriture bloque le fil principal, en plein tri.
Un corpus kNN de quinze cents cartes plus un vocabulaire croisé passe largement la limite.

```js
import { idbStore, localStore, memoryStore } from '@trieur/learn';
createRecommender({ key: 'liens', store: localStore('mon-app:') });
```

Les écritures sont groupées (`saveDelay`, 800 ms), et un `pagehide` déclenche un `flush()` :
fermer l'onglet ne coûte pas les derniers rangements.

## Mode complet

```js
const brain = createRecommender({
  key: 'liens',
  server: { url: 'https://trieur.chez-moi.fr', token: '…' },
});
```

C'est la seule différence dans l'app. Ce qui change dessous :

- **Le local continue de répondre.** Il est instantané et fonctionne hors ligne. Le serveur
  n'est interrogé que lorsque le local se tait — typiquement les premières cartes, ou une
  carte dont aucun trait n'est connu. C'est exactement là que les embeddings servent, et le
  seul moment où attendre le réseau se justifie (400 ms maximum, réglable).
- **Les événements partent en lot**, avec un identifiant chacun. La file est **persistée** :
  un tri fait hors ligne repart au retour du réseau, et un renvoi n'apprend rien deux fois.
- **Démarrage à chaud.** Au premier lancement sur un appareil neuf, le modèle du serveur est
  récupéré s'il en sait plus que le local.

```js
brain.pending;             // événements pas encore acceptés par le serveur
await brain.flush();       // forcer l'envoi
await brain.serverStats(); // ce que le serveur voit, tous appareils confondus
```

Voir la [démo léger vs complet](/demos/serveur), qui coupe le réseau pour de vrai.

## Ce que le modèle a le droit de regarder

`meta(item)` est le seul endroit où tu décides quelles informations entrent dans le modèle.
C'est une frontière utile : ce qui n'est pas dans `meta` n'est jamais appris, jamais
sérialisé, jamais envoyé au serveur.

```js
meta: (lien) => ({
  domain: lien.host,      // trait tel quel
  author: lien.author,    // idem
  tag: lien.tags,         // un trait par élément
  title: lien.title,      // un trait par mot
})
```

Le mode complet ajoute le **texte** de la carte à l'événement — et seulement lui — si `meta`
contient `title`, `text`, `description` ou `excerpt`, parce que les embeddings en ont besoin.
Un `text` explicite dans `record()` l'emporte.

## Brancher autre chose

`advisor` n'exige pas `@trieur/learn` : n'importe quel objet avec `best(meta, zones)` fait
l'affaire, y compris un appel réseau vers ton propre classifieur.

```js
deck.setOptions({
  advisor: {
    async best(meta, zones) {
      const r = await fetch('/api/classer', { method: 'POST', body: JSON.stringify({ meta, zones }) });
      return r.ok ? await r.json() : null; // { id, score, why: [] }
    },
    record: (r) => navigator.sendBeacon('/api/rangements', JSON.stringify(r)),
  },
});
```

Le deck accepte une promesse et **jette la réponse si la carte a changé entre-temps** : un
serveur lent ne fait jamais apparaître une proposition sur la mauvaise carte.

## Événements

Chaque action émet aussi un `CustomEvent` sur le conteneur, pour les hôtes qui préfèrent les
événements aux callbacks :

`trieur:sort`, `trieur:undo`, `trieur:skip`, `trieur:assign`, `trieur:suggest`,
`trieur:expand`, `trieur:empty`, `trieur:error`.

```js
deck.root.addEventListener('trieur:sort', (e) => {
  const { item, zone, predicted, correct } = e.detail;
  if (predicted && !correct) console.log('le modèle proposait', predicted);
});
```
