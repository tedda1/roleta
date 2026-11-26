// Monta a pasta para o pendrive: pacote-totem/ = site estático + scripts de operação.
// Rode depois de "npm run build".
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const raiz = process.cwd();
const saida = join(raiz, "pacote-totem");
const site = join(raiz, "out");

if (!existsSync(site)) {
  console.error('Pasta "out" não encontrada. Rode "npm run build" antes.');
  process.exit(1);
}

rmSync(saida, { recursive: true, force: true });
mkdirSync(saida, { recursive: true });
cpSync(site, join(saida, "site"), { recursive: true });
for (const arq of ["INICIAR.cmd", "servir.ps1", "LEIA-ME.txt"]) {
  cpSync(join(raiz, "operacao", arq), join(saida, arq));
}
if (!existsSync(join(site, "brindes.json"))) {
  console.warn('AVISO: public/brindes.json não existe; o totem usará brindes.exemplo.json (PIN de exemplo).');
}
console.log(`Pacote pronto em ${saida}. Copie a pasta inteira para o PC do evento (ex.: C:\\RoletaConstelacao).`);
