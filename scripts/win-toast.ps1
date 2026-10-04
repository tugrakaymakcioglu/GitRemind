param(
    [string]$Title = "GitRemind",
    [string]$Message = "You have uncommitted changes in your repository!",
    [string]$Subtitle = "",
    [switch]$Sound = $true
)

$ErrorActionPreference = "Stop"

try {
    # Load WinRT Toast Notification assemblies
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    
    # Use ToastText02 or ToastText04 template depending on subtitle
    if ($Subtitle -ne "") {
        $templateType = [Windows.UI.Notifications.ToastTemplateType]::ToastText04
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($templateType)
        $textNodes = $template.GetElementsByTagName("text")
        $textNodes.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
        $textNodes.Item(1).AppendChild($template.CreateTextNode($Subtitle)) | Out-Null
        $textNodes.Item(2).AppendChild($template.CreateTextNode($Message)) | Out-Null
    } else {
        $templateType = [Windows.UI.Notifications.ToastTemplateType]::ToastText02
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($templateType)
        $textNodes = $template.GetElementsByTagName("text")
        $textNodes.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
        $textNodes.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null
    }

    # Audio element configuration
    if (-not $Sound) {
        $audioNode = $template.CreateElement("audio")
        $audioNode.SetAttribute("silent", "true")
        $template.DocumentElement.AppendChild($audioNode) | Out-Null
    }

    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("GitRemind")
    $notification = [Windows.UI.Notifications.ToastNotification]::new($template)
    
    # Expiration: 1 hour max
    $notification.ExpirationTime = [DateTimeOffset]::Now.AddHours(1)
    
    $notifier.Show($notification)
    Write-Output "OK"
} catch {
    # Fallback to WScript Shell popup or console message if WinRT fails
    try {
        $wshell = New-Object -ComObject Wscript.Shell
        # 0 = OK button, 48 = Warning icon, 5 = timeout in seconds
        $wshell.Popup("$Subtitle`n$Message", 7, $Title, 48) | Out-Null
        Write-Output "OK_FALLBACK"
    } catch {
        Write-Error $_.Exception.Message
    }
}
