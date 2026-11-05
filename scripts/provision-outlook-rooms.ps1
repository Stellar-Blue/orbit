<#
.SYNOPSIS
Gives the Orbit app the Exchange permissions it needs to create Outlook rooms.

.DESCRIPTION
Microsoft Graph's Place.ReadWrite.All permission lets the app *list* places, but creating a building,
floor or room also needs Exchange application RBAC:
  * TenantPlacesManagement - manage Places (buildings, floors, rooms)
  * MailRecipient          - create the Exchange room mailbox behind the room
Without them Graph answers a 403 "Insufficient privileges to complete the operation."

Run this from Exchange Online PowerShell as a member of Organization Management (or an Exchange
Administrator). It is idempotent: an existing service principal or role assignment is left alone.

.EXAMPLE
pwsh ./scripts/provision-outlook-rooms.ps1 -AppId b6d728ab-2472-4110-a8b8-7e186cc3bf5a

.EXAMPLE
# When the Microsoft.Graph module is not installed, copy the Object ID from
# Entra ID -> Enterprise applications -> Orbit Outlook Sync.
pwsh ./scripts/provision-outlook-rooms.ps1 -AppId <appId> -ServicePrincipalObjectId <objectId>
#>
param(
  [Parameter(Mandatory = $true)]
  [string] $AppId,

  [string] $ServicePrincipalObjectId,
  [string] $DisplayName = 'Orbit Outlook Sync'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command Connect-ExchangeOnline -ErrorAction SilentlyContinue)) {
  throw 'Exchange Online PowerShell is not installed. Run: Install-Module ExchangeOnlineManagement -Scope CurrentUser'
}

Write-Host "Connecting to Exchange Online…"
Connect-ExchangeOnline -ShowBanner:$false

# 1. Exchange service-principal pointer for the Entra application.
$servicePrincipal = Get-ServicePrincipal -Identity $AppId -ErrorAction SilentlyContinue
if (-not $servicePrincipal) {
  if (-not $ServicePrincipalObjectId -and (Get-Command Get-MgServicePrincipal -ErrorAction SilentlyContinue)) {
    $ServicePrincipalObjectId = (Get-MgServicePrincipal -Filter "appId eq '$AppId'").Id
  }
  if (-not $ServicePrincipalObjectId) {
    throw "Could not resolve the service principal. Pass -ServicePrincipalObjectId: Entra ID -> Enterprise applications -> '$DisplayName' -> Object ID."
  }
  New-ServicePrincipal -AppId $AppId -ObjectId $ServicePrincipalObjectId -DisplayName $DisplayName
  $servicePrincipal = Get-ServicePrincipal -Identity $AppId
}
Write-Host "Service principal: $($servicePrincipal.DisplayName) ($($servicePrincipal.ObjectId))"

# 2. The two application roles Microsoft documents for Places + room mailboxes.
Write-Host 'Application roles this tenant exposes (Place/Recipient):'
Get-ManagementRole | Where-Object { $_.Name -match 'Place|Recipient' } | Select-Object -ExpandProperty Name | ForEach-Object {
  Write-Host "  - $_"
}

foreach ($role in @('TenantPlacesManagement', 'MailRecipient')) {
  try {
    New-ManagementRoleAssignment -App $AppId -Role $role -ErrorAction Stop | Out-Null
    Write-Host "Assigned $role."
  } catch {
    Write-Warning "Could not assign '$role': $($_.Exception.Message)"
    Write-Warning "Pick the matching role from the list above and assign it with: New-ManagementRoleAssignment -App $AppId -Role '<name>'"
  }
}

# 3. Enable Places so the room hierarchy is visible in the room picker.
try {
  if (-not (Get-Command Connect-MicrosoftPlaces -ErrorAction SilentlyContinue)) {
    throw 'MicrosoftPlaces module not installed (Install-Module MicrosoftPlaces -Scope CurrentUser).'
  }
  Connect-MicrosoftPlaces -ErrorAction Stop
  Set-PlacesSettings -EnableBuildings 'Default:true' -ErrorAction Stop
  Write-Host 'Places enabled (buildings visible).'
} catch {
  Write-Warning "Could not enable Places automatically: $($_.Exception.Message)"
  Write-Warning "Run manually: Connect-MicrosoftPlaces; Set-PlacesSettings -EnableBuildings 'Default:true'"
}

# 4. Show what the app is allowed to do now.
try {
  Test-ServicePrincipalAuthorization -Identity $AppId -ErrorAction Stop
} catch {
  Write-Warning "Test-ServicePrincipalAuthorization could not run: $($_.Exception.Message)"
}

Write-Host ''
Write-Host 'Done. Now click Spaces -> Manage -> Sync to Outlook in Orbit.'
