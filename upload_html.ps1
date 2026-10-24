param(
    [ValidateSet('esp32-s3-devkitc-1_ota', 'nodemcuv2_ota')]
    [string]$Environment = 'esp32-s3-devkitc-1_ota'
)

& 'C:\Users\onedr\.platformio\penv\Scripts\platformio.exe' run -e $Environment -t uploadfs --upload-port ghost-controller.local
exit $LASTEXITCODE
