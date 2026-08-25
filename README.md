# @mediatech/kiosk-protocol

Contrat WebSocket de pilotage d'une **borne** ScriptEurist. Isomorphe (Node et
navigateur), aucune dépendance.

## À quoi ça sert

Deux serveurs pilotent des bornes : **`kiosk-hub`** (registre durable de
participants) et **`play`** (soirées de jeux). Sans contrat commun, chacun
aurait fini par parler son dialecte, et la borne aurait dû savoir à qui elle
était branchée pour se comporter correctement.

Ici, les deux bouts valident la **même** chose, et n'importe quelle application
peut piloter une borne sans deviner la forme des messages.

Sortir ce contrat du serveur avait immédiatement révélé un écart que personne
ne pouvait voir : la borne savait appliquer une consigne `sequence` que le
serveur n'avait aucun moyen de lui envoyer.

## Version 1.0 — ce qui a changé

La v0.x nommait ses événements `kiosk_*` et son README interdisait de les
renommer, au motif qu'ils circulaient « sur les bornes installées ». **Il n'y
avait pas de parc installé** : la contrainte était réelle le jour où elle a été
écrite, elle ne l'était plus. Elle a donc été levée, et le contrat refondu en un
seul geste plutôt que dupliqué à côté de lui-même.

| v0.x | v1.0 | Pourquoi |
|---|---|---|
| Jeton d'administration **partagé** par toutes les bornes | Jeton **propre à chaque borne**, révocable seul | Le jeton d'une borne perdue donnait la régie de toutes les autres *et* l'annuaire complet des joueurs. |
| La borne **sonde l'annuaire** toutes les 4 s | **Badge signé**, vérifié **hors ligne** | Un annuaire de plusieurs milliers d'inscrits ne se télécharge pas en boucle — et une borne qui perd le wifi continue de reconnaître les gens. |
| Participant désigné par `pseudo` / `token` | `id` + `displayName` | Un pseudo n'identifie personne durablement. |
| Consigne poussée, **sans retour** | `commandId` + `device_ack` | La console ne savait pas si sa consigne avait été appliquée. |
| — | Consigne `identify` | La console listait « Borne 1, Borne 2, Borne 3 » sans que personne ne sache laquelle était celle du fond de la salle. |

## Installation

```jsonc
"dependencies": {
  "@mediatech/kiosk-protocol": "git+https://github.com/guillaume-scripteurist/kiosk-protocol.git#v1.0.0"
}
```

`dist/` n'est pas versionné : le script `prepare` construit le paquet après le
clone. Si un import échoue sur un `dist/index.js` introuvable, npm a bloqué ce
script — `npm approve-scripts @mediatech/kiosk-protocol`.

## Le protocole

Six événements, sur une seule socket par borne :

```
borne ──▶ serveur    device_hello   s'annonce, présente SON jeton
                     device_state   remonte son écran, sa file d'envoi
                     device_ack     accuse réception d'une consigne

serveur ──▶ borne    device_ready   rattachement accepté, régime d'identité
                     device_error   refus ou incident (`fatal` = ne pas insister)
                     device_command consigne de régie, portant un `commandId`
```

## Deux régimes d'identité, un seul protocole

C'est ce qui permet à deux serveurs de natures opposées de parler la même
langue — l'un durable, l'autre éphémère. Le serveur annonce le sien dans
`device_ready` ; la borne ne choisit rien, elle applique.

| Mode | Pour | Fonctionnement |
|---|---|---|
| `signed` | Registre durable | Le badge porte un HMAC. La borne détient le secret de sa campagne, reçu à l'enrôlement, et **valide sans réseau**. |
| `resolve` | Soirée de jeux | Le badge n'est pas signé — les joueurs naissent pendant la partie, aucun secret ne pouvait les précéder. La borne demande au serveur qui c'est. |

```js
import { verifyBadge, parseBadge } from '@mediatech/kiosk-protocol';

// Mode signed — aucune requête, fonctionne wifi coupé.
const { badge, rejection } = await verifyBadge(qrScanne, secretDeCampagne);
if (rejection === 'expired') afficher('Badge périmé — repassez à l\'accueil.');

// Mode resolve — le serveur identifie.
const lu = parseBadge(qrScanne);
if (lu) await serveur.resoudre(lu.code);
```

`verifyBadge` rend le **motif** du refus et pas un simple `false` : le message
s'affiche sur une borne posée dans une salle, souvent loin de qui pourrait
diagnostiquer. « Badge périmé » et « badge d'une autre campagne » n'appellent
pas le même geste.

## Usage — les consignes

```js
import { DEVICE_EVENTS, normalizeDeviceCommand } from '@mediatech/kiosk-protocol';

// Côté serveur — avant d'envoyer, pour qu'une faute de frappe dans la console
// ne parte pas sur cinq bornes n'y produire que des refus silencieux.
try {
  const commande = normalizeDeviceCommand({
    action: 'mode',
    payload: { mode: 'targeted', displayName: 'Marie', id: 'p-42' },
  });
  const commandId = crypto.randomUUID();
  ws.send(JSON.stringify({ event: DEVICE_EVENTS.COMMAND, commandId, payload: commande }));
} catch (err) {
  res.status(400).json({ error: err.message }); // message destiné à l'organisateur
}

// Côté borne — avant d'appliquer. Le serveur n'est pas la seule chose qui
// puisse se trouver au bout d'une socket : version décalée dans le parc,
// application pilote tierce, mandataire mal configuré.
const { action, ...reste } = payload;
appliquer(normalizeDeviceCommand({ action, payload: reste }));
```

## Le normaliseur est idempotent, et doit le rester

Il tourne **deux fois** sur le trajet console → serveur → borne. La console
envoie le participant à plat (`{id, displayName}`), la sortie le range sous
`target` / `participant` ; la borne repasse cette sortie dans la même fonction.

S'il n'acceptait pas les deux formes, ce second passage effacerait le
participant désigné — et la borne attendrait « quelqu'un » sans savoir qui, au
moment précis où plus personne ne peut le constater. Même raison pour
`playlistId`, que le serveur résout **après** normalisation : le perdre
enverrait la vidéo sans rangement, exactement la vidéo qu'on cherchera ensuite.

Un test verrouille cette propriété pour chaque consigne.

## Consignes

`mode` · `welcome` · `allow` · `flash` · `start` · `stop` · `abort` · `duration`
· `category` · `questionMode` · `sequence` · `question:next` ·
`question:delete` · `refresh` · `identify`

Et une consigne que le serveur pousse de son propre chef, hors de toute saisie
humaine : `questions:sync`. Elle n'est **pas** exposée à la console — l'y mettre
laisserait deux bornes finir la soirée avec deux banques de questions
différentes.

## Développement

```bash
npm install
npm run build
npm test        # 40 tests
```

## Licence

UNLICENSED — usage interne.
