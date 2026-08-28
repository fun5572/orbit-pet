$ErrorActionPreference = "Stop"

try {
  $payload = [Console]::In.ReadToEnd()
  $eventDir = if ($env:ORBIT_PET_EVENT_DIR) {
    $env:ORBIT_PET_EVENT_DIR
  } else {
    Join-Path $env:APPDATA "com.mochasoft.orbitpet\codex-events"
  }
  [IO.Directory]::CreateDirectory($eventDir) | Out-Null

  $id = [Guid]::NewGuid().ToString("N")
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $tempPath = Join-Path $eventDir ".$id.tmp"
  $finalPath = Join-Path $eventDir "$timestamp-$id.json"
  $encoding = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($tempPath, $payload, $encoding)
  [IO.File]::Move($tempPath, $finalPath)

  $cutoff = [DateTime]::UtcNow.AddDays(-7)
  Get-ChildItem -LiteralPath $eventDir -Filter "*.json" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -lt $cutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue
} catch {
  # Hooks are advisory. Orbit Pet being unavailable must never affect Codex.
}

[Console]::Out.Write("{}")
exit 0
