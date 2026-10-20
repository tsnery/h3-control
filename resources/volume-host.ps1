# Long-lived host: one JSON command per stdin line, one JSON response per stdout line.
# Windows PowerShell 5.1, no admin, no external modules, no network.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class H3Volume
{
    const int eRender = 0;
    const uint DEVICE_STATE_ACTIVE = 1;
    const uint STGM_READ = 0;
    const uint CLSCTX_ALL = 23;

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointer;
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorClass { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
        [PreserveSig] int OpenPropertyStore(uint access, out IPropertyStore properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PropVariant value);

    const ushort VT_LPWSTR = 31;
    static readonly Guid AudioEndpointVolumeId = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    static PropertyKey FriendlyNameKey = new PropertyKey { fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), pid = 14 };

    static void Check(int hr)
    {
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
    }

    static string FriendlyName(IMMDevice device)
    {
        IPropertyStore store = null;
        try
        {
            Check(device.OpenPropertyStore(STGM_READ, out store));
            PropVariant value;
            Check(store.GetValue(ref FriendlyNameKey, out value));
            try
            {
                if (value.vt != VT_LPWSTR) return "";
                return Marshal.PtrToStringUni(value.pointer) ?? "";
            }
            finally
            {
                PropVariantClear(ref value);
            }
        }
        finally
        {
            if (store != null) Marshal.ReleaseComObject(store);
        }
    }

    static IAudioEndpointVolume Open(IMMDevice device)
    {
        Guid iid = AudioEndpointVolumeId;
        object endpoint;
        Check(device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out endpoint));
        return (IAudioEndpointVolume)endpoint;
    }

    // Volume endpoint of the active H3 output (never the Hands-Free one), or null.
    // The caller releases the endpoint with Release.
    public static object[] Find()
    {
        IMMDeviceEnumerator enumerator = null;
        IMMDeviceCollection devices = null;
        try
        {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorClass();
            Check(enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, out devices));
            uint count;
            Check(devices.GetCount(out count));
            for (uint index = 0; index < count; index++)
            {
                IMMDevice device = null;
                try
                {
                    Check(devices.Item(index, out device));
                    string name;
                    try { name = FriendlyName(device); }
                    catch (Exception) { continue; }
                    if (name.IndexOf("QCY H3", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (name.IndexOf("Hands-Free", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                    return new object[] { name, Open(device) };
                }
                finally
                {
                    if (device != null) Marshal.ReleaseComObject(device);
                }
            }
            return null;
        }
        finally
        {
            if (devices != null) Marshal.ReleaseComObject(devices);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
    }

    public static void Release(object volume)
    {
        if (volume != null) Marshal.ReleaseComObject(volume);
    }

    public static int GetPercent(object volume)
    {
        float level;
        Check(((IAudioEndpointVolume)volume).GetMasterVolumeLevelScalar(out level));
        return (int)Math.Round(level * 100.0);
    }

    public static bool GetMuted(object volume)
    {
        bool muted;
        Check(((IAudioEndpointVolume)volume).GetMute(out muted));
        return muted;
    }

    public static void SetPercent(object volume, int percent)
    {
        Guid context = Guid.Empty;
        Check(((IAudioEndpointVolume)volume).SetMasterVolumeLevelScalar(percent / 100.0f, ref context));
    }
}
'@

$utf8 = New-Object System.Text.UTF8Encoding($false)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true
$stdout.NewLine = "`n"

$stdout.WriteLine('{"ready":true}')

function Write-Response($response) {
    $stdout.WriteLine(($response | ConvertTo-Json -Compress))
}

function Invoke-VolumeCommand($command) {
    $found = [H3Volume]::Find()
    if ($null -eq $found) {
        return [ordered]@{ id = $command.id; ok = $true; endpoint = $null }
    }
    $endpointName = [string]$found[0]
    $volume = $found[1]
    try {
        if ($command.op -eq 'set') {
            $percent = [int][math]::Min(100, [math]::Max(0, [math]::Round([double]$command.percent)))
            [H3Volume]::SetPercent($volume, $percent)
            return [ordered]@{ id = $command.id; ok = $true }
        }
        if ($command.op -eq 'get') {
            return [ordered]@{
                id = $command.id
                ok = $true
                percent = [H3Volume]::GetPercent($volume)
                muted = [H3Volume]::GetMuted($volume)
                endpointName = $endpointName
            }
        }
        throw "Unknown op: $($command.op)"
    } finally {
        [H3Volume]::Release($volume)
    }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    $id = $null
    try {
        $command = $line | ConvertFrom-Json
        $id = $command.id
        Write-Response (Invoke-VolumeCommand $command)
    } catch {
        Write-Response ([ordered]@{ id = $id; ok = $false; error = $_.Exception.Message })
    }
}
