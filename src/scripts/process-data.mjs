import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_FILE = join(__dirname, '../data/profesionales-limpio.json');
const OUTPUT_DIR = join(__dirname, '../data/provincias');
const INDICE_FILE = join(__dirname, '../data/indice-provincias.json');
const TODOS_FILE = join(__dirname, '../data/profesionales-con-meta.json');

mkdirSync(OUTPUT_DIR, { recursive: true });

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};
const ok = (msg) => console.log(`${C.green}✓${C.reset} ${msg}`);
const err = (msg) => console.log(`${C.red}✗${C.reset} ${msg}`);
const info = (msg) => console.log(`${C.cyan}→${C.reset} ${msg}`);
const hr = () => console.log(`${C.dim}${'─'.repeat(60)}${C.reset}`);

function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

function parsearDireccion(address) {
  if (!address || typeof address !== 'string') return null;
  const partes = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length < 2) return null;

  let cp = '',
    municipio = '',
    provincia = '',
    callePartes = [],
    cpIndex = -1;

  for (let i = partes.length - 1; i >= 0; i--) {
    const m = partes[i].match(/^(\d{5})\s+(.+)$/);
    if (m) {
      cpIndex = i;
      cp = m[1];
      const textoCp = m[2].trim();
      if (i === partes.length - 1) {
        municipio = textoCp;
        provincia = partes.at(-1) ?? '';
      } else {
        municipio = textoCp;
        provincia = partes.at(-1) ?? '';
      }
      let calleHasta = cpIndex;
      const posibleBarrio = partes[cpIndex - 1] ?? '';
      const esBarrio =
        /^[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ\s]+$/.test(posibleBarrio) && !posibleBarrio.match(/\d/);
      if (esBarrio && cpIndex > 1) calleHasta = cpIndex - 1;
      callePartes = partes.slice(0, calleHasta);
      break;
    }
  }

  if (cpIndex === -1) {
    provincia = partes.at(-1) ?? '';
    municipio = partes.at(-2) ?? '';
    callePartes = partes.slice(0, -2);
  }

  provincia = provincia.replace(/^\d{5}\s*/, '').trim();
  municipio = municipio.replace(/^\d{5}\s*/, '').trim();
  if (!provincia || !municipio) return null;

  return {
    calle: callePartes.join(', ').trim(),
    municipio,
    municipio_slug: slugify(municipio),
    provincia,
    provincia_slug: slugify(provincia),
    cp,
  };
}

const ESPECIALIDAD_SLUG = {
  Psicólogo: 'psicologo',
  Psiquiatra: 'psiquiatra',
  Psicoterapeuta: 'psicoterapeuta',
};

console.log(`\n${C.bold}Procesando datos para Astro...${C.reset}\n`);
hr();

let profesionales;
try {
  profesionales = JSON.parse(readFileSync(INPUT_FILE, 'utf-8'));
} catch (e) {
  err(`No se encontró: ${INPUT_FILE}`);
  err('Ejecuta primero: node src/scripts/correction-data.mjs');
  process.exit(1);
}

ok(`${profesionales.length} profesionales leídos`);
hr();

const porProvincia = {},
  todosConMeta = [];
let omitidos = 0;

for (const p of profesionales) {
  const dir = parsearDireccion(p.address);
  if (!dir) {
    console.log(`${C.yellow}⚠${C.reset} Omitido (dirección no parseada): "${p.address}"`);
    omitidos++;
    continue;
  }

  // 1. Se separan las categorías por punto y coma en un array limpio
  const rawCategory = p.google_places?.category ?? '';
  const listaTags = rawCategory
    ? rawCategory
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  // 2. Extraemos la primera como principal para no alterar los slugs existentes
  const categoriaPrincipal = listaTags[0] ?? 'Especialista';
  const especialidad_slug = ESPECIALIDAD_SLUG[categoriaPrincipal] ?? 'especialista';
  const prov_slug = dir.provincia_slug;

  const _meta = {
    slug: slugify(p.name),
    especialidad_slug,
    municipio_slug: dir.municipio_slug,
    provincia_slug: prov_slug,
    especialidad: categoriaPrincipal,
    municipio: dir.municipio,
    provincia: dir.provincia,
    tags: listaTags, // <── Array de strings asignado exitosamente
    calle: dir.calle,
    cp: dir.cp,
    url: `/${especialidad_slug}/${prov_slug}/${dir.municipio_slug}/${slugify(p.name)}/`,
    schema_rating: (p.google_places?.review_count ?? 0) >= 3,
    title_seo: `${p.name} — ${categoriaPrincipal} en ${dir.municipio} (${dir.provincia})`,
    desc_seo: `${categoriaPrincipal} en ${dir.municipio}, ${dir.provincia}. Consulta en ${dir.calle}${p.phone ? `. Llama al ${p.phone}` : ''}.`,
  };

  const profesionalCompleto = { ...p, _meta };
  todosConMeta.push(profesionalCompleto);

  if (!porProvincia[prov_slug])
    porProvincia[prov_slug] = { provincia: dir.provincia, slug: prov_slug, profesionales: [] };
  porProvincia[prov_slug].profesionales.push(profesionalCompleto);
}

hr();
info(`${todosConMeta.length} procesados · ${omitidos} omitidos\n`);

// Colecciones por provincia: provincias/granada/profesionales.json
for (const [slug, data] of Object.entries(porProvincia)) {
  const dir = join(OUTPUT_DIR, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'profesionales.json'), JSON.stringify(data, null, 2), 'utf-8');
  ok(`provincias/${slug}/profesionales.json — ${data.profesionales.length} profesionales`);
}
hr();

// Índice de provincias: indice-provincias.json
const indice = Object.values(porProvincia)
  .map(({ provincia, slug, profesionales: pros }) => ({
    provincia,
    slug,
    total: pros.length,
    psicologos: pros.filter((p) => p._meta.especialidad_slug === 'psicologo').length,
    psiquiatras: pros.filter((p) => p._meta.especialidad_slug === 'psiquiatra').length,
    municipios: [...new Set(pros.map((p) => p._meta.municipio_slug))].length,
    lista_municipios: [...new Set(pros.map((p) => p._meta.municipio_slug))].map((mSlug) => ({
      slug: mSlug,
      nombre: pros.find((p) => p._meta.municipio_slug === mSlug)?._meta.municipio ?? mSlug,
      total: pros.filter((p) => p._meta.municipio_slug === mSlug).length,
    })),
  }))
  .sort((a, b) => b.total - a.total);

writeFileSync(INDICE_FILE, JSON.stringify(indice, null, 2), 'utf-8');
ok(`indice-provincias.json — ${indice.length} provincias`);

// JSON global con _meta: profesionales-con-meta.json
writeFileSync(TODOS_FILE, JSON.stringify(todosConMeta, null, 2), 'utf-8');
ok(`profesionales-con-meta.json — ${todosConMeta.length} profesionales`);

hr();
console.log(`\n${C.bold}Colecciones generadas para Astro:${C.reset}`);
console.log(`
  Directorio /psicologo/
  → import indice from '../data/indice-provincias.json'

  Listado /psicologo/granada/
  → import data from '../data/provincias/granada/profesionales.json'

  Fichas /psicologo/granada/armilla/ana-moles/
  → import todos from '../data/profesionales-con-meta.json'
`);
