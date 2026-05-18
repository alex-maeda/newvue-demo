$body = '{"currentStudyId":"P1-CURRENT-001"}'
$response = Invoke-WebRequest -Uri 'http://localhost:3001/api/v1/patients/Patient_1/summarize' -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 120
$response.Content | Out-File -FilePath 'summarize-test-output.json' -Encoding utf8
Write-Host "Status: $($response.StatusCode)"
Write-Host "Length: $($response.Content.Length)"
