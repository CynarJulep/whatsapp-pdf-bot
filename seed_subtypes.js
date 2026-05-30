require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Config
const GOOGLE_SHEETS_ID = "1zMLQMbF36_Cpw5712_P2OyV0ns7m_mQMzPDNVu6Ide4";
const GOOGLE_SHEETS_GID = "1725838782";
const GOOGLE_SHEETS_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_ID}/export?format=csv&gid=${GOOGLE_SHEETS_GID}`;

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hltyozdvcqfmvqmyrlva.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Initialize Supabase Admin Client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseCSVLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function splitCsvRecords(text) {
  const norm = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const records = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];

    if (c === '"') {
      if (inQuotes && norm[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += '"';
      continue;
    }

    if (c === "\n" && !inQuotes) {
      if (cur.trim() !== "") {
        records.push(cur);
      }
      cur = "";
      continue;
    }

    cur += c;
  }

  if (cur.trim() !== "") {
    records.push(cur);
  }

  return records;
}

function normalizeHeader(h) {
  return h
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^"|"$/g, "")
    .normalize("NFKC");
}

function toCanonicalFieldName(raw) {
  const s = normalizeHeader(raw);
  const ascii = s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const map = {
    tipo: "tipo",
    categoria: "categoria",
    subtipo: "subtipo",
    derivacion: "derivar",
    comentarios: "comentarios",
  };

  return map[ascii] ?? null;
}

async function seed() {
  console.log("Fetching PAI search spreadsheet CSV...");
  try {
    const response = await fetch(GOOGLE_SHEETS_URL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const csvText = await response.text();
    console.log("CSV Downloaded. Parsing...");

    const records = splitCsvRecords(csvText.trim());
    if (records.length === 0) {
      throw new Error("Empty CSV downloaded.");
    }

    const headerCells = parseCSVLine(records[0]);
    const headerKeys = headerCells.map((cell) => toCanonicalFieldName(cell));

    console.log("Headers:", headerKeys);

    const subtypesRows = [];

    for (let i = 1; i < records.length; i++) {
      const values = parseCSVLine(records[i]);
      if (values.length !== headerCells.length) {
        continue;
      }

      const row = {
        tipo: "RECLAMO",
        categoria: "",
        subtipo: "",
        derivar: false,
        comentarios: "",
      };

      for (let j = 0; j < headerKeys.length; j++) {
        const key = headerKeys[j];
        if (key) {
          let val = values[j] ?? "";
          // Remove wrapping quotes if present
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.substring(1, val.length - 1);
          }
          val = val.trim();

          if (key === "derivar") {
            row.derivar = val.toUpperCase() === "DERIVAR";
          } else if (key === "tipo") {
            row.tipo = val || "RECLAMO";
          } else {
            row[key] = val;
          }
        }
      }

      if (row.categoria && row.subtipo) {
        subtypesRows.push(row);
      }
    }

    console.log(`Parsed ${subtypesRows.length} rows from CSV.`);

    // Bulk upload/upsert into public.subtypes_catalog
    console.log("Uploading to Supabase...");
    const { data, error } = await supabase
      .from("subtypes_catalog")
      .upsert(subtypesRows, { onConflict: "tipo,categoria,subtipo" });

    if (error) {
      throw error;
    }

    console.log("Database seed complete! Table subtypes_catalog successfully loaded.");
  } catch (err) {
    console.error("Error in seeding subtypes:", err);
    process.exit(1);
  }
}

seed();
