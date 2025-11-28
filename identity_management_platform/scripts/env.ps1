$ErrorActionPreference = 'Stop'

# Resolve JAVA_HOME (Temurin 17) and Maven
$jdkRoot = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like 'jdk-17*' } |
  Sort-Object Name -Descending | Select-Object -First 1
if ($jdkRoot) {
  $Env:JAVA_HOME = $jdkRoot.FullName
  if (-not ($Env:Path -split ';' | Where-Object { $_ -eq (Join-Path $Env:JAVA_HOME 'bin') })) {
    $Env:Path = (Join-Path $Env:JAVA_HOME 'bin') + ';' + $Env:Path
  }
}

$mvnGuess = "D:\tools\maven\apache-maven-3.9.11\bin\mvn.cmd"
if (Test-Path $mvnGuess) {
  $Global:Mvn = $mvnGuess
} else {
  $Global:Mvn = 'mvn'
}

$Global:Java = if ($Env:JAVA_HOME) { Join-Path $Env:JAVA_HOME 'bin\java.exe' } else { 'java' }

Write-Host "JAVA_HOME = $($Env:JAVA_HOME)" -ForegroundColor Cyan
Write-Host "JAVA = $Global:Java" -ForegroundColor Cyan
Write-Host "MVN = $Global:Mvn" -ForegroundColor Cyan
