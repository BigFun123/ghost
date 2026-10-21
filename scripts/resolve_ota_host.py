import socket
import time


Import("env")


def resolve_ota_host(source, target, env):
    host = env.subst("$UPLOAD_PORT")
    try:
        socket.inet_aton(host)
        return
    except OSError:
        pass

    timeout_seconds = 60
    retry_interval_seconds = 2
    deadline = time.monotonic() + timeout_seconds
    print("Waiting for OTA host %s to resolve..." % host)

    while time.monotonic() < deadline:
        try:
            addresses = socket.getaddrinfo(
                host, None, socket.AF_INET, socket.SOCK_DGRAM
            )
        except socket.gaierror:
            time.sleep(retry_interval_seconds)
            continue

        address = addresses[0][4][0]
        env.Replace(UPLOAD_PORT=address)
        print("Resolved OTA host %s to %s." % (host, address))
        return

    raise RuntimeError(
        "Could not resolve OTA host %s after %d seconds."
        % (host, timeout_seconds)
    )


env.AddPreAction(
    ["upload", "uploadfs", "uploadfsota"],
    resolve_ota_host,
)
