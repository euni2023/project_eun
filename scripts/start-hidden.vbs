' Launch start-server.cmd with no console window (called by Task Scheduler)
Dim sh, here
Set sh = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run """" & here & "start-server.cmd""", 0, False
