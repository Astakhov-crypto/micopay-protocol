/**
 * El flujo de depósito tenía dos huecos, y el segundo es de dinero.
 *
 * 1. Al pulsar "Elegir este agente" saltaba DIRECTO al chat. Sin resumen del
 *    monto, la comisión ni quién es la contraparte. Cash-out sí tenía ese paso;
 *    los dos comprometen dinero, así que los dos deben tenerlo.
 *
 * 2. El chat mostraba, SIEMPRE y con palomita verde, "El agente bloqueó los
 *    activos que recibirás. Ve a su ubicación y entrégale el efectivo." — sin
 *    mirar el estado real y en el instante de llegar, cuando el agente no había
 *    hecho nada.
 *
 *    Eso no es un detalle de redacción: le dice a alguien que vaya a entregar
 *    efectivo porque ya hay garantía, cuando puede no haberla. Es la misma clase
 *    de fallo que "estamos bloqueando tu saldo" y que "operación creada" dos
 *    pantallas antes de crearla — la interfaz afirmando lo que no pasó.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(dir, p), 'utf8');

describe('el depósito pasa por confirmación', () => {
  it('el mapa de depósito ofrece el paso de revisar', () => {
    expect(read('../pages/DepositMap.tsx')).toContain('onProceedToConfirm');
  });

  it('la pantalla de confirmación sirve a los dos flujos', () => {
    const app = read('../App.tsx');
    const route = app.slice(app.indexOf('function ConfirmRoute'), app.indexOf('function ChatRoute'));
    // Antes solo sabía crear cash-out; el depósito ni llegaba aquí.
    expect(route).toContain('handleDepositOfferSelected');
    expect(route).toMatch(/isDeposit \? '\/chat-deposit' : '\/chat'/);
  });
});

describe('el chat de depósito no promete una garantía que no existe', () => {
  const chat = read('../pages/DepositChat.tsx');

  it('mira el estado real de la operación', () => {
    expect(chat).toContain('escrowStatus');
    expect(chat).toContain('parseTradeState');
  });

  it('solo dice que el agente bloqueó cuando de verdad bloqueó', () => {
    // El texto afirmativo queda condicionado; antes se pintaba siempre.
    // #390: la garantía sigue vigente en `revealing` (el agente ya confirmó el
    // efectivo y los fondos siguen en el escrow), así que la condición cubre
    // `locked` y `revealing`, y nunca `pending`.
    expect(chat).toMatch(
      /fondosEnGarantia = escrowStatus === 'locked' \|\| escrowStatus === 'revealing';/,
    );
    expect(chat).toMatch(/fondosEnGarantia[\s\S]{0,200}agentFoundDesc/);
  });

  it('mientras no hay garantía, avisa de NO entregar el efectivo', () => {
    const es = JSON.parse(read('../i18n/es.json'));
    const desc: string = es.chatRoom.depositWaitingLockDesc;
    expect(desc).toMatch(/no entregues/i);
  });
});
