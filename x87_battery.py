#!/usr/bin/env python3
import glob
import json
import os
import select
import sys

def find_hidraw_node():
    # 1. 优先从 /dev/input/by-id 查找固定的 if03 符号链接
    matches = glob.glob("/dev/input/by-id/*0c45*if03*-hidraw")
    if matches:
        return os.path.realpath(matches[0])

    # 2. 从 sysfs 匹配 0c45:fefe 的接口 03
    for path in glob.glob("/sys/bus/hid/devices/0003:0C45:FEFE.*/hidraw/hidraw*"):
        dev_dir = os.path.dirname(os.path.dirname(path))
        parent = os.path.dirname(os.path.realpath(dev_dir))
        intf_file = os.path.join(parent, "bInterfaceNumber")
        if os.path.exists(intf_file):
            try:
                with open(intf_file, "r") as f:
                    if f.read().strip() == "03":
                        return "/dev/" + os.path.basename(path)
            except Exception:
                pass
    return None

def query_battery(dev_path):
    # 33 字节报文：Report ID 0x00, 命令 0x20 0x01, 填充 0, 校验和 0x21
    req = bytearray(33)
    req[0] = 0x00
    req[1] = 0x20
    req[2] = 0x01
    req[32] = 0x21

    try:
        fd = os.open(dev_path, os.O_RDWR | os.O_NONBLOCK)
    except PermissionError:
        return {"online": False, "error": "permission_denied"}
    except Exception as e:
        return {"online": False, "error": str(e)}

    try:
        # 键盘休眠时首次请求用于唤醒射频链路，超时重发一次
        for attempt in range(2):
            try:
                os.write(fd, req)
            except Exception as e:
                return {"online": False, "error": f"write_failed: {e}"}

            r, _, _ = select.select([fd], [], [], 0.25)
            if r:
                try:
                    res = os.read(fd, 64)
                except Exception:
                    continue

                # 响应格式：20 01 00 LEVEL ... (带或不带 0x00 Report ID)
                level = None
                if len(res) >= 4 and res[0] == 0x20 and res[1] == 0x01 and res[2] == 0x00:
                    level = res[3]
                elif len(res) >= 5 and res[0] == 0x00 and res[1] == 0x20 and res[2] == 0x01 and res[3] == 0x00:
                    level = res[4]

                if level is not None and 0 <= level <= 100:
                    return {"online": True, "percentage": level}
    finally:
        os.close(fd)

    return {"online": False, "error": "no_response"}

def main():
    dev_path = find_hidraw_node()
    if not dev_path:
        print(json.dumps({"online": False, "error": "dongle_not_found"}))
        return

    result = query_battery(dev_path)
    result["device"] = dev_path
    print(json.dumps(result))

if __name__ == "__main__":
    main()
