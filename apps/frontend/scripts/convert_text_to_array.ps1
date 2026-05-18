# Convert text file to JSON array of strings
param(
    [string]$FilePath = "F:\Newvue\files\Developer Materials\Clinical Documents - Paula Everly\Clinical Notes\Note_5_HemeOnc.txt"
)

$content = Get-Content $FilePath -Raw

# Split by lines
$lines = $content -split "`r`n"

# Convert to JSON array using ConvertTo-Json (handles escaping properly)
$jsonArray = $lines | ConvertTo-Json -AsArray

# Copy to clipboard
$jsonArray | Set-Clipboard

Write-Host "JSON array copied to clipboard!"
Write-Host $jsonArray
