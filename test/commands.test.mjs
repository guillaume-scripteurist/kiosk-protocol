/**
 * Le normaliseur est la seule barrière entre la console et une borne posée dans
 * une salle. Il vivait dans `server.js` ; ces tests fixent son comportement
 * AVANT la bascule, pour que l'extraction ne soit pas l'occasion d'un
 * changement silencieux.
 *
 * Chaque cas décrit une bêtise qu'on peut faire depuis la console, et ce que la
 * borne doit en recevoir — ou ne pas en recevoir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KIOSK_ACTIONS,
  KIOSK_EVENTS,
  normalizeKioskCommand,
  normalizeKioskAllowlist,
  kioskDuration,
} from '../dist/index.js';

const cmd = (action, payload) => normalizeKioskCommand({ action, payload });

test('une action inconnue est refusée, pas ignorée', () => {
  assert.throws(() => cmd('reboot', {}), /Consigne inconnue : reboot/);
  assert.throws(() => cmd('', {}), /\(vide\)/);
});

test('mode ciblé sans joueur : refusé', () => {
  // Sans ce refus, la borne passerait en « attente de quelqu'un » sans savoir
  // qui, et refuserait tous les badges sans jamais dire pourquoi.
  assert.throws(() => cmd('mode', { mode: 'targeted' }), /exige un joueur/);
  assert.deepEqual(
    cmd('mode', { mode: 'targeted', pseudo: 'Marie' }),
    { action: 'mode', mode: 'targeted', target: { pseudo: 'Marie', token: null }, allowed: null },
  );
});

test('mode liste avec une liste vide : refusé', () => {
  // Une liste vide fermerait la borne en donnant l'impression de l'ouvrir.
  assert.throws(() => cmd('mode', { mode: 'allowlist', allowed: [] }), /au moins un joueur/);
});

test('mode inconnu : refusé', () => {
  assert.throws(() => cmd('mode', { mode: 'ouvert' }), /open, targeted, allowlist ou closed/);
});

test('la liste d\'autorisation déduplique et borne', () => {
  const rows = normalizeKioskAllowlist([
    { token: 'a', pseudo: 'Marie' },
    { token: 'a', pseudo: 'Marie encore' }, // même jeton : ignoré
    { pseudo: 'Paul' },
    { pseudo: 'paul' },                      // même pseudo, casse différente
    { token: '', pseudo: '' },               // vide : ignoré
  ]);
  assert.deepEqual(rows, [
    { token: 'a', pseudo: 'Marie' },
    { token: null, pseudo: 'Paul' },
  ]);
});

test('le pseudo voyage à côté du jeton', () => {
  // La borne doit pouvoir afficher « Réservé à Marie » même sans l'annuaire de
  // la session sous la main.
  const c = cmd('allow', { allowed: [{ token: 'tok', pseudo: 'Marie' }] });
  assert.equal(c.allowed[0].pseudo, 'Marie');
  assert.equal(c.allowed[0].token, 'tok');
});

test('un message vide n\'atteint jamais la borne', () => {
  assert.throws(() => cmd('flash', { message: '   ' }), /Message vide/);
  assert.equal(cmd('flash', { message: 'Bonjour', level: 'panique' }).level, 'info');
  assert.equal(cmd('flash', { message: 'Bonjour', level: 'warn' }).level, 'warn');
});

test('les textes sont tronqués, pas refusés', () => {
  // Un titre trop long est une maladresse, pas une erreur : on le coupe.
  const c = cmd('welcome', { title: 'x'.repeat(500), subtitle: 'y'.repeat(500) });
  assert.equal(c.title.length, 120);
  assert.equal(c.subtitle.length, 200);
});

test('la durée reste dans des bornes tenables', () => {
  assert.equal(kioskDuration(0), 5);
  assert.equal(kioskDuration(99999), 600);
  assert.equal(kioskDuration('45'), 45);
  assert.equal(kioskDuration('n\'importe quoi'), 5);
});

test('démarrage sans joueur : refusé', () => {
  assert.throws(() => cmd('start', {}), /Indiquez un joueur/);
  assert.deepEqual(cmd('start', { pseudo: 'Léa', question: 'Ton pire aveu ?' }), {
    action: 'start',
    player: { pseudo: 'Léa', token: null },
    question: 'Ton pire aveu ?',
  });
});

test('question:next laisse la playlist à résoudre par l\'appelant', () => {
  // La borne ne peut pas deviner la playlist d'une question improvisée : le
  // serveur la résout après normalisation, avant l'envoi.
  const c = cmd('question:next', { text: 'Improvisée' });
  assert.equal(c.playlistId, null);
  assert.equal(c.text, 'Improvisée');
});

/**
 * Le normaliseur tourne DEUX fois sur le trajet console → serveur → borne.
 * S'il n'est pas idempotent, le second passage abîme la consigne au moment
 * précis où plus personne ne peut le voir : sur la borne, dans la salle.
 *
 * On repasse ici chaque sortie dans la fonction, et on exige l'égalité.
 */
test('normaliser deux fois donne le même résultat', () => {
  const cas = [
    ['mode', { mode: 'targeted', pseudo: 'Marie', token: 'tok-1' }],
    ['mode', { mode: 'allowlist', allowed: [{ token: 'a', pseudo: 'Marie' }, { pseudo: 'Paul' }] }],
    ['mode', { mode: 'open' }],
    ['start', { pseudo: 'Léa', token: 'tok-2', question: 'Ton pire aveu ?' }],
    ['welcome', { title: 'Bonjour', subtitle: 'Scannez votre badge' }],
    ['allow', { allowed: [{ token: 'b', pseudo: 'Tom' }] }],
    ['flash', { message: 'Deux minutes', level: 'warn' }],
    ['abort', { reason: 'Pause' }],
    ['duration', { seconds: 45 }],
    ['category', { category: 'ambiance' }],
    ['questionMode', { mode: 'sequence' }],
    ['sequence', { ids: ['q1', 'q2'] }],
    ['question:delete', { id: 'q9' }],
    ['stop', {}],
    ['refresh', {}],
  ];
  for (const [action, payload] of cas) {
    const une = normalizeKioskCommand({ action, payload });
    const { action: a, ...reste } = une;
    const deux = normalizeKioskCommand({ action: a, payload: reste });
    assert.deepEqual(deux, une, `« ${action} » abîmée au second passage`);
  }
});

test('la playlist résolue par le serveur survit à la revalidation', () => {
  // Le serveur résout la playlist APRÈS normalisation puis pousse la consigne ;
  // la borne la revalide. La perdre ici enverrait la vidéo sans rangement —
  // exactement la vidéo qu'on cherchera ensuite.
  const pousse = { action: 'question:next', text: 'Improvisée', playlistId: 'pl-42' };
  const { action, ...reste } = pousse;
  assert.equal(normalizeKioskCommand({ action, payload: reste }).playlistId, 'pl-42');
});

test('question:delete sans identifiant : refusé', () => {
  assert.throws(() => cmd('question:delete', {}), /non identifiée/);
});

test('questionMode retombe sur `random` pour toute valeur inattendue', () => {
  assert.equal(cmd('questionMode', { mode: 'sequence' }).mode, 'sequence');
  assert.equal(cmd('questionMode', { mode: 'alphabétique' }).mode, 'random');
});

test('sequence : identifiants nettoyés et bornés', () => {
  const c = cmd('sequence', { ids: ['q1', '  q2  ', '', null, ...Array(60).fill('q')] });
  assert.equal(c.ids[0], 'q1');
  assert.equal(c.ids[1], 'q2');
  assert.ok(c.ids.length <= 50);
  assert.ok(!c.ids.includes(''));
});

test('les actions sans charge utile restent minimales', () => {
  assert.deepEqual(cmd('stop', {}), { action: 'stop' });
  assert.deepEqual(cmd('refresh', {}), { action: 'refresh' });
  assert.deepEqual(cmd('abort', {}), { action: 'abort', reason: null });
});

test('toute action déclarée est réellement traitée', () => {
  // Garde-fou : ajouter une action à la liste sans l'implémenter est l'erreur
  // qui donne une consigne acceptée par le serveur et ignorée par la borne.
  for (const action of KIOSK_ACTIONS) {
    // On fournit de quoi satisfaire les actions qui exigent un contenu.
    const payload = {
      mode: action === 'mode' ? 'open' : 'random',
      message: 'msg',
      pseudo: 'Marie',
      id: 'q1',
      ids: ['q1'],
    };
    const out = normalizeKioskCommand({ action, payload });
    assert.equal(out.action, action, `action ${action} non traitée`);
  }
});

test('les noms d\'événements ne bougent pas', () => {
  // Un parc de bornes déjà posé ne se met pas à jour le soir de l'événement :
  // renommer ces cinq chaînes couperait toutes les bornes installées.
  assert.deepEqual(KIOSK_EVENTS, {
    JOIN: 'kiosk_join',
    WELCOME: 'kiosk_welcome',
    ERROR: 'kiosk_error',
    COMMAND: 'kiosk_command',
    STATE: 'kiosk_state',
  });
});
