"use strict";

const UNIT_ICON_RADIUS = { inf: 8, scout: 11, eng: 8, arm: 15, art: 16 };
const UNIT_WARNING = { supply: 0.30, suppression: 0.58 };
const unitCardIcons = new Map();

function unitMarkerRadius(type, zoom) {
  return (UNIT_ICON_RADIUS[type] * Math.max(zoom, 0.88) + 2) / zoom;
}

function paintUnitSilhouette(painter, type, scale, angle, color, detailed) {
  const edge = '#101b18';
  const highlight = '#f8e1bf';
  const shape = points => {
    painter.beginPath();
    for (const [i, [x, y]] of points.entries()) {
      if (i) painter.lineTo(x, y);
      else painter.moveTo(x, y);
    }
    painter.closePath();
    painter.fill();
    painter.stroke();
  };
  const circle = (radius, fill, outline) => {
    painter.beginPath();
    painter.arc(0, 0, radius, 0, Math.PI * 2);
    painter.fillStyle = fill;
    painter.fill();
    if (outline) painter.stroke();
  };
  const line = (x1, y1, x2, y2, width, stroke) => {
    painter.beginPath();
    painter.moveTo(x1, y1);
    painter.lineTo(x2, y2);
    painter.lineWidth = width;
    painter.strokeStyle = stroke;
    painter.stroke();
  };

  painter.save();
  painter.scale(scale, scale);
  painter.lineJoin = 'round';
  painter.lineCap = 'round';
  painter.fillStyle = color;
  painter.strokeStyle = edge;
  painter.lineWidth = 1.55;
  switch (type) {
    case 'inf':
      circle(7.8, color, true);
      circle(2.5, edge);
      if (detailed) circle(1, highlight);
      break;
    case 'scout':
      painter.rotate(angle);
      shape([[11, 0], [-7, -7.5], [-4, 0], [-7, 7.5]]);
      if (detailed) line(-1, 0, 4, 0, 1.45, highlight);
      break;
    case 'eng':
      shape([[-5, -8], [5, -8], [8, -5], [8, 5], [5, 8], [-5, 8], [-8, 5], [-8, -5]]);
      line(-3.4, 3.4, 3, -3, 2.15, edge);
      line(0.4, -4.4, 5, 0.2, 2.15, edge);
      break;
    case 'arm':
      painter.rotate(angle);
      painter.fillStyle = edge;
      painter.fillRect(-10.5, -8, 20, 5);
      painter.fillRect(-10.5, 3, 20, 5);
      if (detailed) {
        painter.fillStyle = color;
        for (let x = -8.5; x < 9; x += 3.1) {
          painter.fillRect(x, -7, 1.2, 2);
          painter.fillRect(x, 5, 1.2, 2);
        }
      }
      painter.fillStyle = color;
      shape([[-9, -5], [6, -5], [10, -2], [10, 2], [6, 5], [-9, 5]]);
      line(0, 0, 15, 0, 3.9, edge);
      line(0, 0, 15, 0, 2.25, highlight);
      if (detailed) circle(3.7, color, true);
      break;
    case 'art':
      painter.rotate(angle);
      line(-9, -8, 0, 0, 4.2, edge);
      line(-9, 8, 0, 0, 4.2, edge);
      line(-9, -8, -1.5, -1.5, 2.2, color);
      line(-9, 8, -1.5, 1.5, 2.2, color);
      painter.strokeStyle = edge;
      painter.lineWidth = 1.55;
      shape([[-4, -4], [5, -2.8], [5, 2.8], [-4, 4]]);
      line(2, 0, 16, 0, 4.3, edge);
      line(2, 0, 16, 0, 2.65, highlight);
      break;
  }
  painter.restore();
}

function unitCardIcon(type, side) {
  const key = type + '/' + side;
  if (unitCardIcons.has(key)) return unitCardIcons.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 46;
  const painter = canvas.getContext('2d');
  painter.translate(30, 23);
  paintUnitSilhouette(painter, type, 1.65, -0.36, TEAM_COLORS[side], true);
  const source = canvas.toDataURL();
  unitCardIcons.set(key, source);
  return source;
}

function unitCombatCue(unit) {
  if (Number.isFinite(unit._netCombatCue)) return unit._netCombatCue;
  if (unit._combatLost > 0) return 0;
  if (unit.aimTarget && unit.aimTimer > 0 && UNITS[unit.type].aim) {
    return Math.max(1, Math.round(clamp(1 - unit.aimTimer / UNITS[unit.type].aim, 0, 1) * 100));
  }
  if (!unit._engaged && unit._combatTarget && unit._combatTime > 0) {
    return -Math.max(1, Math.round(clamp(unit._combatTime / OBSERVE_TIME, 0, 1) * 100));
  }
  return 0;
}

function unitCombatStatus(unit) {
  const cue = unitCombatCue(unit);
  if (cue) return (cue > 0 ? '瞄准 ' : '索敌 ') + Math.abs(cue) + '%';
  return unit._engaged ? '交战中' : '';
}
