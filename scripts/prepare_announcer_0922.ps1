param([Parameter(Mandatory=$true)][string]$Ffmpeg)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $root 'public/assets/audio/sources/voice-0922/announcer'
$outputDir = Join-Path $root 'public/assets/audio/announcer'
New-Item -ItemType Directory -Force -Path $sourceDir, $outputDir | Out-Null
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SelectVoice('Microsoft Zira Desktop')
$voice.Rate = 1
$lines = @(
  @{ id='round1'; original='Round One'; translation='第一回合' },
  @{ id='round2'; original='Round Two'; translation='第二回合' },
  @{ id='round3'; original='Final Round'; translation='决胜回合' },
  @{ id='fight'; original='Fight!'; translation='开战！' },
  @{ id='ko'; original='K. O.'; translation='击倒！' },
  @{ id='nextRound'; original='Next Round'; translation='下一回合' }
)
$records = foreach ($line in $lines) {
  $source = Join-Path $sourceDir ($line.id + '-zira-0922.wav')
  $output = Join-Path $outputDir ($line.id + '-0922.wav')
  if (-not (Test-Path -LiteralPath $source)) {
    $voice.SetOutputToWaveFile($source)
    $voice.Speak($line.original)
    $voice.SetOutputToNull()
  }
  if (-not (Test-Path -LiteralPath $output)) {
    & $Ffmpeg -nostdin -v error -i $source -af 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,highpass=f=100,acompressor=threshold=0.2:ratio=3,loudnorm=I=-18:TP=-2:LRA=7,afade=t=in:d=0.005' -ar 44100 -ac 1 $output
    if ($LASTEXITCODE -ne 0) { throw 'Announcer processing failed' }
  }
  @{
    id=$line.id; file=('assets/audio/announcer/' + $line.id + '-0922.wav'); original=$line.original
    translation=$line.translation; label=$line.translation; transcriptVerified=$true
    source='Windows System.Speech Microsoft Zira Desktop; rate=1; exact synthesis text, not a human/character recording'
    sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower()
    sha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLower()
    listeningStatus='Not human auditioned; synthesized script is known, final listening acceptance pending'
  }
}
$voice.Dispose()
$records | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'scripts/announcer_manifest_0922.json') -Encoding utf8

# Audition identifiers only; never included in the runtime cue catalog.
$numbers = New-Object System.Speech.Synthesis.SpeechSynthesizer
$numbers.SelectVoice('Microsoft Zira Desktop')
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($number in 1..14) {
  $numberFile = Join-Path $sourceDir ('number-{0:00}.wav' -f $number)
  if (-not (Test-Path -LiteralPath $numberFile)) {
    $numbers.SetOutputToWaveFile($numberFile, $format)
    $numbers.Speak([string]$number)
    $numbers.SetOutputToNull()
  }
}
$numbers.Dispose()
