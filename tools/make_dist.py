# 배포본(메일로 보낼 압축 파일) 만들기:  cd tools && node build.js && python make_dist.py
import os, sys, zipfile, datetime, hashlib, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
today = datetime.date.today().strftime('%Y%m%d')
out_dir = os.path.join(root, '배포'); os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, f'보건소지도_배포본_{today}.zip')
folder = '보건소지도'
files = [  # (원본, 압축 안 이름)
    (os.path.join(root, 'index.html'), '보건소지도.html'),
    (os.path.join(root, 'docs', '사용방법.txt'), '사용방법.txt'),
    (os.path.join(root, 'data', 'dist', '보건소_값입력_양식.xlsx'), '보건소_값입력_양식.xlsx'),
    (os.path.join(root, '보건소_행정동_매핑표.xlsx'), '보건소_행정동_매핑표.xlsx'),
]
for src, _ in files:
    if not os.path.exists(src): sys.exit('없음: ' + src + '  (먼저 node build.js)')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for src, name in files:
        data = open(src, 'rb').read()
        if name.endswith('.txt'):   # 메모장에서 한글이 깨지지 않게 UTF-8(BOM) + 윈도우 줄바꿈
            data = '﻿'.encode('utf-8') + data.decode('utf-8').replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')
        z.writestr(f'{folder}/{name}', data)
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    print(out)
    for i in z.infolist(): print(f'  {i.filename}  {i.file_size/1048576:.1f}MB')
print(f'압축 파일 크기 {os.path.getsize(out)/1048576:.1f}MB')
