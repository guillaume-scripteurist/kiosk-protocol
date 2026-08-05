# @mediatech/kiosk-protocol

Contrat WebSocket de pilotage d'une **borne** ScriptEurist. Isomorphe (Node et
navigateur), aucune dépendance.

## À quoi ça sert

Le contrat vivait dans le serveur seul. La borne appliquait donc ce qui arrivait
sur sa socket sans pouvoir le vérifier, et une application tierce n'avait aucun
moyen de connaître la forme attendue. Ici, les deux bouts valident la même chose
— et n'importe quelle application peut piloter une borne.

Sortir ce contrat a immédiatement révélé un écart que personne ne pouvait voir :
la borne savait appliquer une consigne `sequence` que le serveur n'avait aucun
moyen de lui envoyer.

## Installation

```jsonc
"dependencies": {
  "@mediatech/kiosk-protocol": "git+ssh://git@github.com/guillaume-scripteurist/kiosk-protocol.git#v0.1.0"
}
```

## Le protocole

Cinq événements, sur une seule socket par borne :

```
borne ──▶ serveur    kiosk_join     s'annonce, présente son jeton
                     kiosk_state    remonte son écran, sa file d'envoi

serveur ──▶ borne    kiosk_welcome  rattachement accepté
                     kiosk_error    refus ou incident (`fatal` = ne pas insister)
                     kiosk_command  consigne de régie
```

**Ces cinq chaînes ne doivent pas changer.** Elles circulent sur les bornes
installées, et une borne posée dans une salle ne se met pas à jour le soir de
l'événement.

## Usage

```js
import { KIOSK_EVENTS, normalizeKioskCommand } from '@mediatech/kiosk-protocol';

// Côté serveur — avant d'envoyer, pour qu'une faute de frappe dans la console
// ne parte pas sur cinq bornes n'y produire que des refus silencieux.
try {
  const commande = normalizeKioskCommand({ action: 'mode', payload: { mode: 'targeted', pseudo: 'Marie' } });
  ws.send(JSON.stringify({ event: KIOSK_EVENTS.COMMAND, payload: commande }));
} catch (err) {
  res.status(400).json({ error: err.message }); // message destiné à l'organisateur
}

// Côté borne — avant d'appliquer. Le serveur n'est pas la seule chose qui puisse
// se trouver au bout d'une socket : version décalée dans le parc, application
// pilote tierce, mandataire mal configuré.
const { action, ...reste } = payload;
appliquer(normalizeKioskCommand({ action, payload: reste }));
```

## Le normaliseur est idempotent, et doit le rester

Il tourne **deux fois** sur le trajet console → serveur → borne. La console
envoie le joueur à plat (`{pseudo, token}`), la sortie le range sous `target` /
`player` ; la borne repasse cette sortie dans la même fonction.

S'il n'acceptait pas les deux formes, ce second passage effacerait le joueur
désigné — et la borne attendrait « quelqu'un » sans savoir qui, au moment précis
où plus personne ne peut le constater. Même raison pour `playlistId`, que le
serveur résout **après** normalisation : le perdre enverrait la vidéo sans
rangement, exactement la vidéo qu'on cherchera ensuite.

Un test verrouille cette propriété pour chaque consigne.

## Consignes

`mode` · `welcome` · `allow` · `flash` · `start` · `stop` · `abort` · `duration`
· `category` · `questionMode` · `sequence` · `question:next` · `question:delete`
· `refresh`

Plus `questions:sync`, **poussée par le serveur seul** : la banque de questions
vit dans le compte Streamlike, et l'éditer borne par borne garantissait que deux
bornes finissent la soirée avec deux banques différentes.

La spécification complète (charges utiles, bornes de longueur, états) est en
AsyncAPI dans le dépôt applicatif : `docs/kiosk-protocol.asyncapi.yaml`.

## Développement

```bash
npm install
npm test
```

## Licence

UNLICENSED — usage interne.
