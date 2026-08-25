/**
 * Le normaliseur est la seule barrière entre la console et une borne posée
 * dans une salle. Chaque cas décrit une bêtise qu'on peut faire depuis la
 * console, et ce que la borne doit en recevoir — ou ne pas en recevoir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEVICE_ACTIONS,
  DEVICE_EVENTS,
  normalizeDeviceCommand,
  normalizeParticipantList,
  deviceDuration,
} from '../dist/index.js';

const cmd = (action, payload) => normalizeDeviceCommand({ action, payload });

test('une action inconnue est refusée, pas ignorée', () => {
  assert.throws(() => cmd('reboot', {}), /Consigne inconnue : reboot/);
  assert.throws(() => cmd('', {}), /\(vide\)/);
});

test('mode ciblé sans participant : refusé', () => {
  // Sans ce refus, la borne passerait en « attente de quelqu'un » sans savoir
  // qui, et refuserait tous les badges sans jamais dire pourquoi.
  assert.throws(() => cmd('mode', { mode: 'targeted' }), /exige un participant/);
  assert.deepEqual(cmd('mode', { mode: 'targeted', displayName: 'Marie' }), {
    action: 'mode',
    mode: 'targeted',
    target: { id: null, displayName: 'Marie' },
    allowed: null,
  });
});

test('mode liste avec une liste vide : refusé', () => {
  // Une liste vide fermerait la borne en donnant l'impression de l'ouvrir.
  assert.throws(() => cmd('mode', { mode: 'allowlist', allowed: [] }), /au moins un participant/);
});

test('mode inconnu : refusé', () => {
  assert.throws(() => cmd('mode', { mode: 'ouvert' }), /open, targeted, allowlist ou closed/);
});

test('la liste d\'autorisation déduplique et borne', () => {
  const rows = normalizeParticipantList([
    { id: 'p1', displayName: 'Marie' },
    { id: 'p1', displayName: 'Marie encore' }, // même identifiant : ignoré
    { displayName: 'Paul' },
    { displayName: 'paul' },                    // même nom, casse différente
    { id: '', displayName: '' },                // vide : ignoré
  ]);
  assert.deepEqual(rows, [
    { id: 'p1', displayName: 'Marie' },
    { id: null, displayName: 'Paul' },
  ]);
});

test('le nom voyage à côté de l\'identifiant', () => {
  // La borne doit pouvoir afficher « Réservé à Marie » sans rien résoudre :
  // elle n'a pas d'annuaire, et peut ne pas avoir de réseau.
  const c = cmd('allow', { allowed: [{ id: 'p1', displayName: 'Marie' }] });
  assert.equal(c.allowed[0].displayName, 'Marie');
  assert.equal(c.allowed[0].id, 'p1');
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
  assert.equal(deviceDuration(0), 5);
  assert.equal(deviceDuration(99999), 600);
  assert.equal(deviceDuration('45'), 45);
  assert.equal(deviceDuration('n\'importe quoi'), 5);
});

test('démarrage sans participant : refusé', () => {
  assert.throws(() => cmd('start', {}), /Indiquez un participant/);
  assert.deepEqual(cmd('start', { displayName: 'Léa', question: 'Ton pire aveu ?' }), {
    action: 'start',
    participant: { id: null, displayName: 'Léa' },
    question: 'Ton pire aveu ?',
  });
});

test('question:next laisse la playlist à résoudre par l\'appelant', () => {
  const c = cmd('question:next', { text: 'Improvisée' });
  assert.equal(c.playlistId, null);
  assert.equal(c.text, 'Improvisée');
});

test('identify borne la durée du clignotement', () => {
  // Trop court, on rate le signal en traversant la salle ; trop long, la borne
  // clignote encore devant les invités quand on l'a déjà trouvée.
  assert.equal(cmd('identify', {}).seconds, 10);
  assert.equal(cmd('identify', { seconds: 1 }).seconds, 2);
  assert.equal(cmd('identify', { seconds: 999 }).seconds, 60);
});

/**
 * Le normaliseur tourne DEUX fois sur le trajet console → serveur → borne.
 * S'il n'est pas idempotent, le second passage abîme la consigne au moment
 * précis où plus personne ne peut le voir : sur la borne, dans la salle.
 */
test('normaliser deux fois donne le même résultat', () => {
  const cas = [
    ['mode', { mode: 'targeted', id: 'p1', displayName: 'Marie' }],
    ['mode', { mode: 'allowlist', allowed: [{ id: 'p1', displayName: 'Marie' }, { displayName: 'Paul' }] }],
    ['mode', { mode: 'open' }],
    ['start', { id: 'p2', displayName: 'Léa', question: 'Ton pire aveu ?' }],
    ['welcome', { title: 'Bonjour', subtitle: 'Scannez votre badge' }],
    ['allow', { allowed: [{ id: 'p3', displayName: 'Tom' }] }],
    ['flash', { message: 'Deux minutes', level: 'warn' }],
    ['abort', { reason: 'Pause' }],
    ['duration', { seconds: 45 }],
    ['category', { category: 'ambiance' }],
    ['questionMode', { mode: 'sequence' }],
    ['sequence', { ids: ['q1', 'q2'] }],
    ['question:delete', { id: 'q9' }],
    ['identify', { seconds: 15 }],
    ['stop', {}],
    ['refresh', {}],
  ];
  for (const [action, payload] of cas) {
    const une = normalizeDeviceCommand({ action, payload });
    const { action: a, ...reste } = une;
    const deux = normalizeDeviceCommand({ action: a, payload: reste });
    assert.deepEqual(deux, une, `« ${action} » abîmée au second passage`);
  }
});

test('la playlist résolue par le serveur survit à la revalidation', () => {
  // Le serveur résout la playlist APRÈS normalisation puis pousse la consigne ;
  // la borne la revalide. La perdre ici enverrait la vidéo sans rangement —
  // exactement la vidéo qu'on cherchera ensuite.
  const pousse = { action: 'question:next', text: 'Improvisée', playlistId: 'pl-42' };
  const { action, ...reste } = pousse;
  assert.equal(normalizeDeviceCommand({ action, payload: reste }).playlistId, 'pl-42');
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
  for (const action of DEVICE_ACTIONS) {
    const payload = {
      mode: action === 'mode' ? 'open' : 'random',
      message: 'msg',
      displayName: 'Marie',
      id: 'q1',
      ids: ['q1'],
    };
    const out = normalizeDeviceCommand({ action, payload });
    assert.equal(out.action, action, `action ${action} non traitée`);
  }
});

test('les six événements de la v2 sont ceux attendus', () => {
  assert.deepEqual(DEVICE_EVENTS, {
    HELLO: 'device_hello',
    READY: 'device_ready',
    ERROR: 'device_error',
    COMMAND: 'device_command',
    STATE: 'device_state',
    ACK: 'device_ack',
  });
});
