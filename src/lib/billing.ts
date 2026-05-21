import { ChargeMode } from './types';

export const SERVICE_FEE_PER_KWH = 0.8;

export function getEnergyPriceAt(date: Date): number {
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  if ((hour >= 10 && hour < 15) || (hour >= 18 && hour < 21)) return 1.0;
  if ((hour >= 7 && hour < 10) || (hour >= 15 && hour < 18) || (hour >= 21 && hour < 23)) return 0.7;
  return 0.4;
}

function nextPriceBoundary(date: Date): Date {
  const boundaries = [7, 10, 15, 18, 21, 23].map(hour => {
    const d = new Date(date);
    d.setHours(hour, 0, 0, 0);
    return d;
  });
  for (const boundary of boundaries) {
    if (boundary.getTime() > date.getTime()) return boundary;
  }
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  next.setHours(7, 0, 0, 0);
  return next;
}

export function getModePowerKwhPerHour(mode: ChargeMode | string): number {
  return mode === ChargeMode.Fast || mode === 'fast' ? 30 : 10;
}

export function estimateChargeMinutes(mode: ChargeMode | string, requestedKwh: number): number {
  return Math.ceil((requestedKwh / getModePowerKwhPerHour(mode)) * 60);
}

export function calculateTimeOfUseFee(
  startTime: Date,
  energyKwh: number,
  mode: ChargeMode | string
) {
  const power = getModePowerKwhPerHour(mode);
  const durationHours = energyKwh / power;
  const endTime = new Date(startTime.getTime() + durationHours * 60 * 60 * 1000);

  let cursor = new Date(startTime);
  let remainingKwh = energyKwh;
  let energyFee = 0;

  while (remainingKwh > 0.000001 && cursor.getTime() < endTime.getTime()) {
    const boundary = nextPriceBoundary(cursor);
    const segmentEnd = boundary.getTime() < endTime.getTime() ? boundary : endTime;
    const hours = (segmentEnd.getTime() - cursor.getTime()) / 3600000;
    const segmentKwh = Math.min(remainingKwh, power * hours);
    energyFee += segmentKwh * getEnergyPriceAt(cursor);
    remainingKwh -= segmentKwh;
    cursor = new Date(segmentEnd);
  }

  const serviceFee = energyKwh * SERVICE_FEE_PER_KWH;
  return {
    energyFee: Math.round(energyFee * 100) / 100,
    serviceFee: Math.round(serviceFee * 100) / 100,
    totalFee: Math.round((energyFee + serviceFee) * 100) / 100,
    durationMinutes: Math.ceil(durationHours * 60),
    endTime,
  };
}
