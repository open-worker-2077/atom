function New-AtomLongRunningTaskSettings {
  [CmdletBinding()]
  param()

  $settings = New-ScheduledTaskSettingsSet `
    -Hidden `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -Priority 4 `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1)
  $settings.UseUnifiedSchedulingEngine = $false
  $settings
}
