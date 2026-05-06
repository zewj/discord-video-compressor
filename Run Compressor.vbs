' Launches the app via wscript.exe so no console window appears.
' (electron.exe is a GUI binary — its own window shows normally.)
' Style 1 (SW_SHOWNORMAL) is required: style 0 hides the child's first
' ShowWindow call, so the BrowserWindow would never appear.
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir
sh.Run """" & appDir & "\node_modules\electron\dist\electron.exe"" """ & appDir & """", 1, False
