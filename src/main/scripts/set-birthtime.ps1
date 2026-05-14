param(
  [string]$FilePath,
  [long]$WindowsFileTime
)
$p = [System.IO.Path]::GetFullPath($FilePath)
(Get-Item $p).CreationTimeUtc = [datetime]::FromFileTimeUtc($WindowsFileTime)