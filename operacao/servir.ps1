<#
  Servidor estático mínimo para a roleta (não precisa de Node nem de internet).
  Escuta SOMENTE em http://localhost:<Porta>/ (não fica exposto na rede).

  Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File servir.ps1 [-Pasta site] [-Porta 4173]

  IMPORTANTE: use sempre a mesma porta. Os dados da roleta (CPFs usados, jogadas) ficam
  guardados no navegador PARA ESTE ENDEREÇO. Outra porta = roleta "zerada".
#>
param(
  [string]$Pasta = (Join-Path $PSScriptRoot 'site'),
  [int]$Porta = 4173
)
$ErrorActionPreference = 'Stop'
# Qualquer erro fatal fica visível (a janela não fecha sozinha).
trap {
  Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  Read-Host 'Pressione Enter para fechar'
  exit 1
}

if (-not (Test-Path -LiteralPath $Pasta)) { throw "Pasta do site não encontrada: $Pasta" }
$raiz = (Resolve-Path -LiteralPath $Pasta).Path.TrimEnd('\') + '\'

$tipos = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
  '.woff2' = 'font/woff2'; '.woff' = 'font/woff'; '.ttf' = 'font/ttf'; '.otf' = 'font/otf'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'; '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'; '.map' = 'application/json'; '.wasm' = 'application/wasm'
}

$ouvinte = New-Object System.Net.HttpListener
$ouvinte.Prefixes.Add("http://localhost:$Porta/")
try { $ouvinte.Start() } catch { throw "Não foi possível abrir a porta $Porta. Ela já está em uso? ($($_.Exception.Message))" }
Write-Host "Roleta no ar em http://localhost:$Porta/   (feche esta janela para parar)"

function Enviar-Arquivo($resposta, [string]$arquivo, [int]$status) {
  $ext = [IO.Path]::GetExtension($arquivo).ToLowerInvariant()
  $tipo = $tipos[$ext]; if (-not $tipo) { $tipo = 'application/octet-stream' }
  $bytes = [IO.File]::ReadAllBytes($arquivo)
  $resposta.StatusCode = $status
  $resposta.ContentType = $tipo
  if ($arquivo -like '*\_next\static\*') { $resposta.Headers['Cache-Control'] = 'public, max-age=31536000, immutable' }
  else { $resposta.Headers['Cache-Control'] = 'no-store' }
  $resposta.ContentLength64 = $bytes.Length
  $resposta.OutputStream.Write($bytes, 0, $bytes.Length)
}

while ($ouvinte.IsListening) {
  $ctx = $ouvinte.GetContext()
  $resposta = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/').Replace('/', '\')
    $alvo = [IO.Path]::GetFullPath((Join-Path $raiz $rel))
    if (-not $alvo.StartsWith($raiz, [StringComparison]::OrdinalIgnoreCase) -and ($alvo + '\') -ne $raiz) {
      $resposta.StatusCode = 403
    }
    elseif (Test-Path -LiteralPath $alvo -PathType Container) {
      if (-not $ctx.Request.Url.AbsolutePath.EndsWith('/')) {
        $resposta.StatusCode = 301
        $resposta.RedirectLocation = $ctx.Request.Url.AbsolutePath + '/'
      }
      else {
        $indice = Join-Path $alvo 'index.html'
        if (Test-Path -LiteralPath $indice) { Enviar-Arquivo $resposta $indice 200 } else { $resposta.StatusCode = 404 }
      }
    }
    elseif (Test-Path -LiteralPath $alvo -PathType Leaf) {
      Enviar-Arquivo $resposta $alvo 200
    }
    else {
      $html404 = Join-Path $raiz '404.html'
      if (Test-Path -LiteralPath $html404) { Enviar-Arquivo $resposta $html404 404 } else { $resposta.StatusCode = 404 }
    }
  }
  catch {
    try { $resposta.StatusCode = 500 } catch {}
    Write-Warning $_.Exception.Message
  }
  finally {
    try { $resposta.Close() } catch {}
  }
}
