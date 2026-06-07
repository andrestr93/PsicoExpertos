import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_FILE = join(__dirname, '../data/profesionales-limpio.json');
const OUTPUT_DIR = join(__dirname, '../data/provincias');
const INDICE_FILE = join(__dirname, '../data/indice-provincias.json');
const LOG_FILE = join(__dirname, '../data/errores-validacion.json');

mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Colores para consola ────────────────────────────────────────────────────
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
const warn = (msg) => console.log(`${C.yellow}⚠${C.reset} ${msg}`);
const info = (msg) => console.log(`${C.cyan}→${C.reset} ${msg}`);
const hr = () => console.log(`${C.dim}${'─'.repeat(60)}${C.reset}`);

// ─── Utilidades ─────────────────────────────────────────────────────────────
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

// Provincias válidas de España (para validación)
const PROVINCIAS_VALIDAS = new Set([
  'alava',
  'albacete',
  'alicante',
  'almeria',
  'asturias',
  'avila',
  'badajoz',
  'barcelona',
  'burgos',
  'caceres',
  'cadiz',
  'cantabria',
  'castellon',
  'ciudad real',
  'cordoba',
  'cuenca',
  'girona',
  'granada',
  'guadalajara',
  'gipuzkoa',
  'huelva',
  'huesca',
  'illes balears',
  'jaen',
  'la rioja',
  'las palmas',
  'leon',
  'lleida',
  'lugo',
  'madrid',
  'malaga',
  'murcia',
  'navarra',
  'ourense',
  'palencia',
  'pontevedra',
  'salamanca',
  'santa cruz de tenerife',
  'segovia',
  'sevilla',
  'soria',
  'tarragona',
  'teruel',
  'toledo',
  'valencia',
  'valladolid',
  'vizcaya',
  'bizkaia',
  'zamora',
  'zaragoza',
  'a coruna',
  'ceuta',
  'melilla',
]);

// Categorías válidas
const CATEGORIAS_VALIDAS = new Set(['Psicólogo', 'Psiquiatra', 'Psicoterapeuta']);

// ─── Parser de dirección ─────────────────────────────────────────────────────
// Maneja los dos formatos encontrados en el JSON real:
//
// FORMATO A — CP en el penúltimo fragmento:
//   "C. Olivo, 4, 18100 Armilla, Granada"
//   partes: ["C. Olivo", "4", "18100 Armilla", "Granada"]
//
// FORMATO B — CP pegado a la provincia (último fragmento):
//   "C. Pedro Antonio de Alarcón, 41, Ronda, 18004 Granada"
//   partes: ["C. Pedro Antonio...", "41", "Ronda", "18004 Granada"]
//
// FORMATO C — Con barrio intercalado antes del CP+municipio:
//   "Av. de Barcelona, 4, local 2, Zaidín, 18006 Granada"
//   partes: ["Av...", "4", "local 2", "Zaidín", "18006 Granada"]
//
// ESTRATEGIA: buscar el fragmento que contiene el CP (5 dígitos)
// y a partir de ahí deducir municipio y provincia.

function parsearDireccion(address) {
  if (!address || typeof address !== 'string') return null;

  const partes = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length < 2) return null;

  let cp = '';
  let municipio = '';
  let provincia = '';
  let callePartes = [];

  // Buscar qué fragmento contiene un CP de 5 dígitos
  // Puede estar en cualquier posición desde el penúltimo en adelante
  let cpIndex = -1;

  for (let i = partes.length - 1; i >= 0; i--) {
    const cpMatch = partes[i].match(/^(\d{5})\s+(.+)$/);
    if (cpMatch) {
      cpIndex = i;
      cp = cpMatch[1];
      // El texto tras el CP en este fragmento es el municipio o la provincia
      const textoTrasCP = cpMatch[2].trim();

      if (i === partes.length - 1) {
        // FORMATO B/C: "18004 Granada" es el último → municipio=ciudad, provincia=misma ciudad
        // Pero realmente en España el texto tras el CP suele ser la ciudad
        // y la provincia es la misma palabra (Granada capital = municipio y provincia)
        municipio = textoTrasCP;
        // La provincia la inferimos: si el fragmento anterior es un barrio conocido
        // o una palabra sin CP, lo descartamos; la provincia = municipio si son iguales
        // o buscamos si hay otro fragmento con la provincia
        provincia = textoTrasCP;
      } else {
        // FORMATO A: "18100 Armilla" está en penúltimo → provincia es el último fragmento
        municipio = textoTrasCP;
        provincia = partes.at(-1) ?? '';
      }

      // La calle son todos los fragmentos antes del índice donde encontramos el CP
      // pero hay que excluir barrios que vienen justo antes (sin números, texto puro)
      // Los barrios típicos: "Ronda", "Zaidín", "Centro", "Genil", "Beiro"...
      // Heurística: si el fragmento anterior al CP no tiene números y es solo texto,
      // probablemente es un barrio → lo excluimos de la calle pero lo guardamos
      let calleHasta = cpIndex;
      const posibleBarrio = partes[cpIndex - 1] ?? '';
      const esBarrio =
        /^[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ\s]+$/.test(posibleBarrio) && !posibleBarrio.match(/\d/);

      if (esBarrio && cpIndex > 1) {
        calleHasta = cpIndex - 1;
      }

      callePartes = partes.slice(0, calleHasta);
      break;
    }
  }

  // Si no encontramos CP, intentar parseo básico:
  // último fragmento = provincia, penúltimo = municipio
  if (cpIndex === -1) {
    provincia = partes.at(-1) ?? '';
    municipio = partes.at(-2) ?? '';
    callePartes = partes.slice(0, -2);
  }

  // Limpiar: quitar CP residual de provincia si lo hubiera (por si acaso)
  provincia = provincia.replace(/^\d{5}\s*/, '').trim();
  municipio = municipio.replace(/^\d{5}\s*/, '').trim();

  const calle = callePartes.join(', ').trim();

  if (!provincia || !municipio) return null;

  return {
    calle,
    municipio,
    municipio_slug: slugify(municipio),
    provincia,
    provincia_slug: slugify(provincia),
    cp,
  };
}

// ─── Validaciones por campo ───────────────────────────────────────────────────
function validarProfesional(p, index) {
  const errores = [];
  const avisos = [];

  // name
  if (!p.name || typeof p.name !== 'string' || p.name.trim() === '') {
    errores.push('name: campo vacío o ausente');
  } else if (p.name.length > 120) {
    avisos.push(`name: muy largo (${p.name.length} chars) — puede afectar al title SEO`);
  }

  // address
  if (!p.address || typeof p.address !== 'string') {
    errores.push('address: campo vacío o ausente');
  } else {
    const dir = parsearDireccion(p.address);

    if (!dir) {
      errores.push(`address: formato no reconocido → "${p.address}"`);
    } else {
      if (!dir.cp) {
        avisos.push(`address: sin código postal detectado → "${p.address}"`);
      } else if (!/^\d{5}$/.test(dir.cp)) {
        avisos.push(`address: código postal inválido "${dir.cp}"`);
      }

      if (!dir.municipio) {
        errores.push(`address: no se pudo extraer el municipio → "${p.address}"`);
      }

      if (!dir.provincia) {
        errores.push(`address: no se pudo extraer la provincia → "${p.address}"`);
      } else {
        const provNorm = dir.provincia
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        if (!PROVINCIAS_VALIDAS.has(provNorm)) {
          avisos.push(
            `address: provincia desconocida "${dir.provincia}" — verifica que sea correcta`,
          );
        }
      }

      if (!dir.calle) {
        avisos.push(`address: no se detectó calle → "${p.address}"`);
      }
    }
  }

  // phone
  if (!p.phone) {
    avisos.push('phone: ausente — el CTA de llamada no funcionará');
  } else {
    const phoneClean = p.phone.replace(/\s/g, '');
    if (!/^[6789]\d{8}$/.test(phoneClean)) {
      avisos.push(
        `phone: formato inusual "${p.phone}" — verifica que sea un número español válido`,
      );
    }
  }

  // google_places
  if (!p.google_places) {
    errores.push('google_places: bloque ausente');
  } else {
    if (!p.google_places.place_id) {
      errores.push('google_places.place_id: ausente');
    }
    if (!p.google_places.category) {
      errores.push('google_places.category: ausente');
    } else if (!CATEGORIAS_VALIDAS.has(p.google_places.category)) {
      avisos.push(`google_places.category: valor inesperado "${p.google_places.category}"`);
    }
    if (
      typeof p.google_places.average_rating !== 'number' ||
      p.google_places.average_rating < 0 ||
      p.google_places.average_rating > 5
    ) {
      avisos.push(
        `google_places.average_rating: valor fuera de rango "${p.google_places.average_rating}"`,
      );
    }
    if (typeof p.google_places.review_count !== 'number' || p.google_places.review_count < 0) {
      avisos.push(`google_places.review_count: valor inválido "${p.google_places.review_count}"`);
    }
    if (
      typeof p.google_places.latitude !== 'number' ||
      typeof p.google_places.longitude !== 'number'
    ) {
      avisos.push('google_places: coordenadas ausentes o no numéricas');
    } else {
      // Coordenadas deben estar dentro de España peninsular + islas (aproximado)
      const { latitude: lat, longitude: lng } = p.google_places;
      if (lat < 27.5 || lat > 44.0 || lng < -18.5 || lng > 4.5) {
        avisos.push(`google_places: coordenadas fuera de España (${lat}, ${lng})`);
      }
    }

    // Schema: no emitir aggregateRating si hay menos de 3 reseñas
    if (
      typeof p.google_places.review_count === 'number' &&
      p.google_places.review_count > 0 &&
      p.google_places.review_count < 3
    ) {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const INPUT_FILE = join(__dirname, '../data/profesionales.json');
      const OUTPUT_DIR = join(__dirname, '../data/provincias');
      const INDICE_FILE = join(__dirname, '../data/indice-provincias.json');
      const LOG_FILE = join(__dirname, '../data/errores-validacion.json');

      mkdirSync(OUTPUT_DIR, { recursive: true });

      // ─── Colores para consola ────────────────────────────────────────────────────
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
      const warn = (msg) => console.log(`${C.yellow}⚠${C.reset} ${msg}`);
      const info = (msg) => console.log(`${C.cyan}→${C.reset} ${msg}`);
      const hr = () => console.log(`${C.dim}${'─'.repeat(60)}${C.reset}`);

      // ─── Utilidades ─────────────────────────────────────────────────────────────
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

      // Provincias válidas de España (para validación)
      const PROVINCIAS_VALIDAS = new Set([
        'alava',
        'albacete',
        'alicante',
        'almeria',
        'asturias',
        'avila',
        'badajoz',
        'barcelona',
        'burgos',
        'caceres',
        'cadiz',
        'cantabria',
        'castellon',
        'ciudad real',
        'cordoba',
        'cuenca',
        'girona',
        'granada',
        'guadalajara',
        'gipuzkoa',
        'huelva',
        'huesca',
        'illes balears',
        'jaen',
        'la rioja',
        'las palmas',
        'leon',
        'lleida',
        'lugo',
        'madrid',
        'malaga',
        'murcia',
        'navarra',
        'ourense',
        'palencia',
        'pontevedra',
        'salamanca',
        'santa cruz de tenerife',
        'segovia',
        'sevilla',
        'soria',
        'tarragona',
        'teruel',
        'toledo',
        'valencia',
        'valladolid',
        'vizcaya',
        'bizkaia',
        'zamora',
        'zaragoza',
        'a coruna',
        'ceuta',
        'melilla',
      ]);

      // Categorías válidas
      const CATEGORIAS_VALIDAS = new Set(['Psicólogo', 'Psiquiatra', 'Psicoterapeuta']);

      // ─── Parser de dirección ─────────────────────────────────────────────────────
      // Maneja los dos formatos encontrados en el JSON real:
      //
      // FORMATO A — CP en el penúltimo fragmento:
      //   "C. Olivo, 4, 18100 Armilla, Granada"
      //   partes: ["C. Olivo", "4", "18100 Armilla", "Granada"]
      //
      // FORMATO B — CP pegado a la provincia (último fragmento):
      //   "C. Pedro Antonio de Alarcón, 41, Ronda, 18004 Granada"
      //   partes: ["C. Pedro Antonio...", "41", "Ronda", "18004 Granada"]
      //
      // FORMATO C — Con barrio intercalado antes del CP+municipio:
      //   "Av. de Barcelona, 4, local 2, Zaidín, 18006 Granada"
      //   partes: ["Av...", "4", "local 2", "Zaidín", "18006 Granada"]
      //
      // ESTRATEGIA: buscar el fragmento que contiene el CP (5 dígitos)
      // y a partir de ahí deducir municipio y provincia.

      function parsearDireccion(address) {
        if (!address || typeof address !== 'string') return null;

        const partes = address
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        if (partes.length < 2) return null;

        let cp = '';
        let municipio = '';
        let provincia = '';
        let callePartes = [];

        // Buscar qué fragmento contiene un CP de 5 dígitos
        // Puede estar en cualquier posición desde el penúltimo en adelante
        let cpIndex = -1;

        for (let i = partes.length - 1; i >= 0; i--) {
          const cpMatch = partes[i].match(/^(\d{5})\s+(.+)$/);
          if (cpMatch) {
            cpIndex = i;
            cp = cpMatch[1];
            // El texto tras el CP en este fragmento es el municipio o la provincia
            const textoTrasCP = cpMatch[2].trim();

            if (i === partes.length - 1) {
              // FORMATO B/C: "18004 Granada" es el último → municipio=ciudad, provincia=misma ciudad
              // Pero realmente en España el texto tras el CP suele ser la ciudad
              // y la provincia es la misma palabra (Granada capital = municipio y provincia)
              municipio = textoTrasCP;
              // La provincia la inferimos: si el fragmento anterior es un barrio conocido
              // o una palabra sin CP, lo descartamos; la provincia = municipio si son iguales
              // o buscamos si hay otro fragmento con la provincia
              provincia = textoTrasCP;
            } else {
              // FORMATO A: "18100 Armilla" está en penúltimo → provincia es el último fragmento
              municipio = textoTrasCP;
              provincia = partes.at(-1) ?? '';
            }

            // La calle son todos los fragmentos antes del índice donde encontramos el CP
            // pero hay que excluir barrios que vienen justo antes (sin números, texto puro)
            // Los barrios típicos: "Ronda", "Zaidín", "Centro", "Genil", "Beiro"...
            // Heurística: si el fragmento anterior al CP no tiene números y es solo texto,
            // probablemente es un barrio → lo excluimos de la calle pero lo guardamos
            let calleHasta = cpIndex;
            const posibleBarrio = partes[cpIndex - 1] ?? '';
            const esBarrio =
              /^[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ\s]+$/.test(posibleBarrio) &&
              !posibleBarrio.match(/\d/);

            if (esBarrio && cpIndex > 1) {
              calleHasta = cpIndex - 1;
            }

            callePartes = partes.slice(0, calleHasta);
            break;
          }
        }

        // Si no encontramos CP, intentar parseo básico:
        // último fragmento = provincia, penúltimo = municipio
        if (cpIndex === -1) {
          provincia = partes.at(-1) ?? '';
          municipio = partes.at(-2) ?? '';
          callePartes = partes.slice(0, -2);
        }

        // Limpiar: quitar CP residual de provincia si lo hubiera (por si acaso)
        provincia = provincia.replace(/^\d{5}\s*/, '').trim();
        municipio = municipio.replace(/^\d{5}\s*/, '').trim();

        const calle = callePartes.join(', ').trim();

        if (!provincia || !municipio) return null;

        return {
          calle,
          municipio,
          municipio_slug: slugify(municipio),
          provincia,
          provincia_slug: slugify(provincia),
          cp,
        };
      }

      // ─── Validaciones por campo ───────────────────────────────────────────────────
      function validarProfesional(p, index) {
        const errores = [];
        const avisos = [];

        // name
        if (!p.name || typeof p.name !== 'string' || p.name.trim() === '') {
          errores.push('name: campo vacío o ausente');
        } else if (p.name.length > 120) {
          avisos.push(`name: muy largo (${p.name.length} chars) — puede afectar al title SEO`);
        }

        // address
        if (!p.address || typeof p.address !== 'string') {
          errores.push('address: campo vacío o ausente');
        } else {
          const dir = parsearDireccion(p.address);

          if (!dir) {
            errores.push(`address: formato no reconocido → "${p.address}"`);
          } else {
            if (!dir.cp) {
              avisos.push(`address: sin código postal detectado → "${p.address}"`);
            } else if (!/^\d{5}$/.test(dir.cp)) {
              avisos.push(`address: código postal inválido "${dir.cp}"`);
            }

            if (!dir.municipio) {
              errores.push(`address: no se pudo extraer el municipio → "${p.address}"`);
            }

            if (!dir.provincia) {
              errores.push(`address: no se pudo extraer la provincia → "${p.address}"`);
            } else {
              const provNorm = dir.provincia
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
              if (!PROVINCIAS_VALIDAS.has(provNorm)) {
                avisos.push(
                  `address: provincia desconocida "${dir.provincia}" — verifica que sea correcta`,
                );
              }
            }

            if (!dir.calle) {
              avisos.push(`address: no se detectó calle → "${p.address}"`);
            }
          }
        }

        // phone
        if (!p.phone) {
          avisos.push('phone: ausente — el CTA de llamada no funcionará');
        } else {
          const phoneClean = p.phone.replace(/\s/g, '');
          if (!/^[6789]\d{8}$/.test(phoneClean)) {
            avisos.push(
              `phone: formato inusual "${p.phone}" — verifica que sea un número español válido`,
            );
          }
        }

        // google_places
        if (!p.google_places) {
          errores.push('google_places: bloque ausente');
        } else {
          if (!p.google_places.place_id) {
            errores.push('google_places.place_id: ausente');
          }
          if (!p.google_places.category) {
            errores.push('google_places.category: ausente');
          } else if (!CATEGORIAS_VALIDAS.has(p.google_places.category)) {
            avisos.push(`google_places.category: valor inesperado "${p.google_places.category}"`);
          }
          if (
            typeof p.google_places.average_rating !== 'number' ||
            p.google_places.average_rating < 0 ||
            p.google_places.average_rating > 5
          ) {
            avisos.push(
              `google_places.average_rating: valor fuera de rango "${p.google_places.average_rating}"`,
            );
          }
          if (
            typeof p.google_places.review_count !== 'number' ||
            p.google_places.review_count < 0
          ) {
            avisos.push(
              `google_places.review_count: valor inválido "${p.google_places.review_count}"`,
            );
          }
          if (
            typeof p.google_places.latitude !== 'number' ||
            typeof p.google_places.longitude !== 'number'
          ) {
            avisos.push('google_places: coordenadas ausentes o no numéricas');
          } else {
            // Coordenadas deben estar dentro de España peninsular + islas (aproximado)
            const { latitude: lat, longitude: lng } = p.google_places;
            if (lat < 27.5 || lat > 44.0 || lng < -18.5 || lng > 4.5) {
              avisos.push(`google_places: coordenadas fuera de España (${lat}, ${lng})`);
            }
          }

          // Schema: no emitir aggregateRating si hay menos de 3 reseñas
          if (
            typeof p.google_places.review_count === 'number' &&
            p.google_places.review_count > 0 &&
            p.google_places.review_count < 3
          ) {
            avisos.push(
              `google_places.review_count: solo ${p.google_places.review_count} reseña(s) — ` +
                'Google puede ignorar el schema aggregateRating con menos de 3',
            );
          }
        }

        // email
        if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
          avisos.push(`email: formato inválido "${p.email}"`);
        }

        // website
        if (p.website && !/^https?:\/\/.+/.test(p.website)) {
          avisos.push(`website: URL sin protocolo "${p.website}"`);
        }

        return { errores, avisos };
      }

      // ─── Detección de duplicados ─────────────────────────────────────────────────
      function detectarDuplicados(profesionales) {
        const vistos = {};
        const duplicados = [];

        for (const p of profesionales) {
          // Duplicado por place_id
          const pid = p.google_places?.place_id;
          if (pid) {
            if (vistos[pid]) {
              duplicados.push({
                tipo: 'place_id duplicado',
                valor: pid,
                registros: [vistos[pid].name, p.name],
              });
            } else {
              vistos[pid] = p;
            }
          }

          // Duplicado por teléfono
          if (p.phone) {
            const phoneKey = `tel_${p.phone.replace(/\s/g, '')}`;
            if (vistos[phoneKey]) {
              duplicados.push({
                tipo: 'teléfono duplicado',
                valor: p.phone,
                registros: [vistos[phoneKey].name, p.name],
              });
            } else {
              vistos[phoneKey] = p;
            }
          }
        }

        return duplicados;
      }

      // ─── MAIN ────────────────────────────────────────────────────────────────────
      console.log(`\n${C.bold}Procesando JSON de profesionales...${C.reset}\n`);
      hr();

      // 1. Leer fichero
      let raw;
      try {
        raw = readFileSync(INPUT_FILE, 'utf-8');
      } catch (e) {
        err(`No se encontró el fichero: ${INPUT_FILE}`);
        process.exit(1);
      }

      let profesionales;
      try {
        profesionales = JSON.parse(raw);
      } catch (e) {
        err(`El JSON no es válido: ${e.message}`);
        process.exit(1);
      }

      if (!Array.isArray(profesionales)) {
        err('El JSON debe ser un array de profesionales');
        process.exit(1);
      }

      ok(`Fichero leído — ${profesionales.length} registros`);
      hr();

      // 2. Validar cada registro
      info('Validando registros...\n');

      const erroresLog = [];
      let totalErrores = 0;
      let totalAvisos = 0;
      let totalOk = 0;
      const invalidos = new Set();

      for (let i = 0; i < profesionales.length; i++) {
        const p = profesionales[i];
        const { errores, avisos } = validarProfesional(p, i);

        if (errores.length > 0) {
          totalErrores += errores.length;
          invalidos.add(i);
          err(`[${i}] ${p.name ?? '(sin nombre)'}`);
          errores.forEach((e) => console.log(`      ${C.red}ERROR:${C.reset} ${e}`));
          erroresLog.push({ index: i, name: p.name, errores, avisos });
        }

        if (avisos.length > 0) {
          totalAvisos += avisos.length;
          if (errores.length === 0) {
            warn(`[${i}] ${p.name}`);
            erroresLog.push({ index: i, name: p.name, errores: [], avisos });
          }
          avisos.forEach((a) => console.log(`      ${C.yellow}AVISO:${C.reset} ${a}`));
        }

        if (errores.length === 0 && avisos.length === 0) totalOk++;
      }

      hr();

      // 3. Detectar duplicados
      info('Buscando duplicados...\n');
      const duplicados = detectarDuplicados(profesionales);
      if (duplicados.length > 0) {
        duplicados.forEach((d) => {
          warn(`${d.tipo}: "${d.valor}"`);
          console.log(`      → ${d.registros.join(' / ')}`);
        });
      } else {
        ok('Sin duplicados detectados');
      }

      hr();

      // 4. Resumen de validación
      console.log(`\n${C.bold}Resumen validación:${C.reset}`);
      console.log(`  ${C.green}✓ OK:${C.reset}      ${totalOk} registros`);
      console.log(`  ${C.yellow}⚠ Avisos:${C.reset}  ${totalAvisos} (procesados igualmente)`);
      console.log(`  ${C.red}✗ Errores:${C.reset} ${invalidos.size} registros omitidos del output`);
      console.log(`  Duplicados: ${duplicados.length}\n`);

      // Guardar log de errores
      writeFileSync(
        LOG_FILE,
        JSON.stringify({ generado: new Date().toISOString(), erroresLog, duplicados }, null, 2),
      );
      info(`Log guardado en src/data/errores-validacion.json`);
      hr();

      // 5. Filtrar registros inválidos y procesar
      const validos = profesionales.filter((_, i) => !invalidos.has(i));
      info(`Procesando ${validos.length} registros válidos...\n`);

      const porProvincia = {};

      for (const p of validos) {
        const dir = parsearDireccion(p.address);
        if (!dir) continue;

        const slug = dir.provincia_slug;
        if (!porProvincia[slug]) {
          porProvincia[slug] = { provincia: dir.provincia, slug, profesionales: [] };
        }

        porProvincia[slug].profesionales.push({
          ...p,
          _meta: {
            slug: slugify(p.name),
            municipio: dir.municipio,
            municipio_slug: dir.municipio_slug,
            provincia: dir.provincia,
            provincia_slug: slug,
            cp: dir.cp,
            calle: dir.calle,
            url: `/psicologo/${slug}/${dir.municipio_slug}/${slugify(p.name)}/`,
            schema_rating: (p.google_places?.review_count ?? 0) >= 3,
          },
        });
      }

      // 6. Escribir JSONs por provincia — una subcarpeta por provincia
      for (const [slug, data] of Object.entries(porProvincia)) {
        // Crear subcarpeta: provincias/granada/
        const provinciaDir = join(OUTPUT_DIR, slug);
        mkdirSync(provinciaDir, { recursive: true });

        // Escribir el fichero dentro: provincias/granada/profesionales.json
        const outputPath = join(provinciaDir, 'profesionales.json');
        writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
        ok(`${slug}/profesionales.json — ${data.profesionales.length} profesionales`);
      }

      hr();

      // 7. Escribir índice de provincias
      const indice = Object.values(porProvincia)
        .map(({ provincia, slug, profesionales: pros }) => ({
          provincia,
          slug,
          total: pros.length,
          psicologos: pros.filter((p) => p.google_places.category === 'Psicólogo').length,
          psiquiatras: pros.filter((p) => p.google_places.category === 'Psiquiatra').length,
          municipios: [...new Set(pros.map((p) => p._meta.municipio_slug))].length,
        }))
        .sort((a, b) => b.total - a.total);

      writeFileSync(INDICE_FILE, JSON.stringify(indice, null, 2), 'utf-8');

      console.log(`\n${C.bold}Output generado:${C.reset}`);
      ok(`indice-provincias.json — ${indice.length} provincias`);
      ok(`Total profesionales en output: ${validos.length}`);
      console.log();

      avisos.push(
        `google_places.review_count: solo ${p.google_places.review_count} reseña(s) — ` +
          'Google puede ignorar el schema aggregateRating con menos de 3',
      );
    }
  }

  // email
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
    avisos.push(`email: formato inválido "${p.email}"`);
  }

  // website
  if (p.website && !/^https?:\/\/.+/.test(p.website)) {
    avisos.push(`website: URL sin protocolo "${p.website}"`);
  }

  return { errores, avisos };
}

// ─── Detección de duplicados ─────────────────────────────────────────────────
function detectarDuplicados(profesionales) {
  const vistos = {};
  const duplicados = [];

  for (const p of profesionales) {
    // Duplicado por place_id
    const pid = p.google_places?.place_id;
    if (pid) {
      if (vistos[pid]) {
        duplicados.push({
          tipo: 'place_id duplicado',
          valor: pid,
          registros: [vistos[pid].name, p.name],
        });
      } else {
        vistos[pid] = p;
      }
    }

    // Duplicado por teléfono
    if (p.phone) {
      const phoneKey = `tel_${p.phone.replace(/\s/g, '')}`;
      if (vistos[phoneKey]) {
        duplicados.push({
          tipo: 'teléfono duplicado',
          valor: p.phone,
          registros: [vistos[phoneKey].name, p.name],
        });
      } else {
        vistos[phoneKey] = p;
      }
    }
  }

  return duplicados;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}Procesando JSON de profesionales...${C.reset}\n`);
hr();

// 1. Leer fichero
let raw;
try {
  raw = readFileSync(INPUT_FILE, 'utf-8');
} catch (e) {
  err(`No se encontró el fichero: ${INPUT_FILE}`);
  process.exit(1);
}

let profesionales;
try {
  profesionales = JSON.parse(raw);
} catch (e) {
  err(`El JSON no es válido: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(profesionales)) {
  err('El JSON debe ser un array de profesionales');
  process.exit(1);
}

ok(`Fichero leído — ${profesionales.length} registros`);
hr();

// 2. Validar cada registro
info('Validando registros...\n');

const erroresLog = [];
let totalErrores = 0;
let totalAvisos = 0;
let totalOk = 0;
const invalidos = new Set();

for (let i = 0; i < profesionales.length; i++) {
  const p = profesionales[i];
  const { errores, avisos } = validarProfesional(p, i);

  if (errores.length > 0) {
    totalErrores += errores.length;
    invalidos.add(i);
    err(`[${i}] ${p.name ?? '(sin nombre)'}`);
    errores.forEach((e) => console.log(`      ${C.red}ERROR:${C.reset} ${e}`));
    erroresLog.push({ index: i, name: p.name, errores, avisos });
  }

  if (avisos.length > 0) {
    totalAvisos += avisos.length;
    if (errores.length === 0) {
      warn(`[${i}] ${p.name}`);
      erroresLog.push({ index: i, name: p.name, errores: [], avisos });
    }
    avisos.forEach((a) => console.log(`      ${C.yellow}AVISO:${C.reset} ${a}`));
  }

  if (errores.length === 0 && avisos.length === 0) totalOk++;
}

hr();

// 3. Detectar duplicados
info('Buscando duplicados...\n');
const duplicados = detectarDuplicados(profesionales);
if (duplicados.length > 0) {
  duplicados.forEach((d) => {
    warn(`${d.tipo}: "${d.valor}"`);
    console.log(`      → ${d.registros.join(' / ')}`);
  });
} else {
  ok('Sin duplicados detectados');
}

hr();

// 4. Resumen de validación
console.log(`\n${C.bold}Resumen validación:${C.reset}`);
console.log(`  ${C.green}✓ OK:${C.reset}      ${totalOk} registros`);
console.log(`  ${C.yellow}⚠ Avisos:${C.reset}  ${totalAvisos} (procesados igualmente)`);
console.log(`  ${C.red}✗ Errores:${C.reset} ${invalidos.size} registros omitidos del output`);
console.log(`  Duplicados: ${duplicados.length}\n`);

// Guardar log de errores
writeFileSync(
  LOG_FILE,
  JSON.stringify({ generado: new Date().toISOString(), erroresLog, duplicados }, null, 2),
);
info(`Log guardado en src/data/errores-validacion.json`);
hr();

// 5. Filtrar registros inválidos y procesar
const validos = profesionales.filter((_, i) => !invalidos.has(i));
info(`Procesando ${validos.length} registros válidos...\n`);

const porProvincia = {};

for (const p of validos) {
  const dir = parsearDireccion(p.address);
  if (!dir) continue;

  const slug = dir.provincia_slug;
  if (!porProvincia[slug]) {
    porProvincia[slug] = { provincia: dir.provincia, slug, profesionales: [] };
  }

  porProvincia[slug].profesionales.push({
    ...p,
    _meta: {
      slug: slugify(p.name),
      municipio: dir.municipio,
      municipio_slug: dir.municipio_slug,
      provincia: dir.provincia,
      provincia_slug: slug,
      cp: dir.cp,
      calle: dir.calle,
      url: `/psicologo/${slug}/${dir.municipio_slug}/${slugify(p.name)}/`,
      schema_rating: (p.google_places?.review_count ?? 0) >= 3,
    },
  });
}

// 6. Escribir JSONs por provincia
for (const [slug, data] of Object.entries(porProvincia)) {
  const outputPath = join(OUTPUT_DIR, `${slug}.json`);
  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  ok(`${slug}.json — ${data.profesionales.length} profesionales`);
}

hr();

// 7. Escribir índice de provincias
const indice = Object.values(porProvincia)
  .map(({ provincia, slug, profesionales: pros }) => ({
    provincia,
    slug,
    total: pros.length,
    psicologos: pros.filter((p) => p.google_places.category === 'Psicólogo').length,
    psiquiatras: pros.filter((p) => p.google_places.category === 'Psiquiatra').length,
    municipios: [...new Set(pros.map((p) => p._meta.municipio_slug))].length,
  }))
  .sort((a, b) => b.total - a.total);

writeFileSync(INDICE_FILE, JSON.stringify(indice, null, 2), 'utf-8');

console.log(`\n${C.bold}Output generado:${C.reset}`);
ok(`indice-provincias.json — ${indice.length} provincias`);
ok(`Total profesionales en output: ${validos.length}`);
console.log();
