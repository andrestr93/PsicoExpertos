import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT = join(__dirname, '../data/profesionales.json');
const OUTPUT = join(__dirname, '../data/profesionales-limpio.json');

// ─── Colores ─────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};
const ok = (msg) => console.log(`${C.green}✓${C.reset} ${msg}`);
const fix = (msg) => console.log(`${C.yellow}⚡${C.reset} ${msg}`);
const info = (msg) => console.log(`${C.cyan}→${C.reset} ${msg}`);
const hr = () => console.log(`${C.dim}${'─'.repeat(60)}${C.reset}`);

// ─── Mapa de categorías Google → especialidad principal ───────────────────────
// Prioridad: Psiquiatra > Psicólogo > Psicoterapeuta > resto
const PRIORIDAD = [
  'Psiquiatra',
  'Psicólogo',
  'Psicoterapeuta',
  'Psicólogo infantil',
  'Consejero matrimonial',
];

function normalizarCategoria(raw) {
  if (!raw) return null;
  const categorias = raw.split(';').map((c) => c.trim());

  // Devolver la primera que esté en nuestra lista de prioridad
  for (const prioridad of PRIORIDAD) {
    if (categorias.includes(prioridad)) return prioridad;
  }

  // Si no hay ninguna conocida, devolver la primera del listado
  return categorias[0] ?? null;
}

// ─── Limpiar emails múltiples → quedarse con el primero válido ────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAILS_BASURA = new Set([
  'dpo-google@google.com',
  'dpo@adobe.com',
  'dpo@wordpress.org',
  'mail@example.com',
  'email@example.com',
  'soporte@doctoralia.com',
  'contacto-es@doctoralia.com',
]);

function normalizarEmail(raw) {
  if (!raw) return null;
  const candidatos = raw.split(',').map((e) => e.trim());
  const valido = candidatos.find((e) => EMAIL_REGEX.test(e) && !EMAILS_BASURA.has(e));
  return valido ?? null;
}

// ─── Limpiar nombre largo → truncar en la primera puntuación o pipe ───────────
function normalizarNombre(raw) {
  if (!raw) return raw;
  // Truncar en | o en . cuando el nombre ya es descriptivo
  const corte = raw.search(/[|]/);
  if (corte > 10) return raw.slice(0, corte).trim();
  // Si tiene frases descriptivas tras el nombre real (todo mayúsculas seguido de .)
  const partes = raw.split(/\.\s+/);
  if (partes.length > 1 && raw.length > 80) return partes[0].trim();
  return raw;
}

// ─── Normalizar rating/review_count null ──────────────────────────────────────
function normalizarRating(gp) {
  return {
    ...gp,
    average_rating: typeof gp.average_rating === 'number' ? gp.average_rating : null,
    review_count: typeof gp.review_count === 'number' ? gp.review_count : 0,
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}Corrigiendo datos automáticamente...${C.reset}\n`);
hr();

const profesionales = JSON.parse(readFileSync(INPUT, 'utf-8'));
info(`${profesionales.length} registros leídos\n`);

let totalFixes = 0;
const contadores = {
  categoria: 0,
  email: 0,
  nombre: 0,
  rating_null: 0,
};

const corregidos = profesionales.map((p, i) => {
  const cambios = [];
  let pc = { ...p, google_places: { ...p.google_places } };

  const rawCategory = pc.google_places?.category ?? '';
  pc.tags = rawCategory
    ? rawCategory
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  // 1 ── CATEGORÍA: Mantenemos la cadena con ";" intacta para procesarla en el script de Astro

  if (pc.google_places?.category?.includes(';')) {
    const original = pc.google_places.category;
    const limpia = normalizarCategoria(original);
    pc.google_places.category = limpia;
    cambios.push(`category: "${original}" → "${limpia}"`);
    contadores.categoria++;
  }

  // 2 ── EMAIL: múltiples o basura → primer email válido
  if (pc.email && (pc.email.includes(',') || EMAILS_BASURA.has(pc.email))) {
    const original = pc.email;
    const limpio = normalizarEmail(original);
    pc.email = limpio;
    cambios.push(`email: "${original}" → "${limpio ?? 'null'}"`);
    contadores.email++;
  }

  // 3 ── NOMBRE: demasiado largo → truncar
  if (pc.name && pc.name.length > 80) {
    const original = pc.name;
    const corto = normalizarNombre(original);
    if (corto !== original) {
      pc.name = corto;
      cambios.push(`name: "${original.slice(0, 50)}..." → "${corto}"`);
      contadores.nombre++;
    }
  }

  // 4 ── RATING NULL: normalizar a valores seguros
  if (pc.google_places?.average_rating === null || pc.google_places?.review_count === null) {
    pc.google_places = normalizarRating(pc.google_places);
    cambios.push(`rating/review_count: null → valores seguros (0)`);
    contadores.rating_null++;
  }

  // Log de cambios aplicados
  if (cambios.length > 0) {
    fix(`[${i}] ${p.name}`);
    cambios.forEach((c) => console.log(`      ${C.yellow}→${C.reset} ${c}`));
    totalFixes += cambios.length;
  } else {
    ok(`[${i}] ${p.name}`);
  }

  return pc;
});

hr();
console.log(`\n${C.bold}Resumen correcciones:${C.reset}`);
console.log(`  Categorías normalizadas:  ${contadores.categoria}`);
console.log(`  Emails limpiados:         ${contadores.email}`);
console.log(`  Nombres truncados:        ${contadores.nombre}`);
console.log(`  Ratings null saneados:    ${contadores.rating_null}`);
console.log(`  Total cambios aplicados:  ${totalFixes}\n`);

info('Duplicado de teléfono 601 50 96 52 detectado:');
info('  Sanamente Centro de Psicología + Psicóloga Granada Lidia Arredondo');
info('  Mismo edificio, profesionales distintas → se mantienen ambos registros\n');

writeFileSync(OUTPUT, JSON.stringify(corregidos, null, 2), 'utf-8');
ok(`profesionales-limpio.json escrito — ${corregidos.length} registros`);
console.log();
