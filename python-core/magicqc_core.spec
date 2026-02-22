# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['core_main.py'],
    pathex=['D:\\work\\react\\operatorPannel-main\\python-core'],
    binaries=[('D:\\work\\react\\operatorPannel-main\\python-core\\integration.cp313-win_amd64.pyd', '.'), ('D:\\work\\react\\operatorPannel-main\\python-core\\measurement_worker.cp313-win_amd64.pyd', '.'), ('D:\\work\\react\\operatorPannel-main\\python-core\\worker_logger.cp313-win_amd64.pyd', '.')],
    datas=[],
    hiddenimports=['worker_logger', 'measurement_worker', 'calibration_worker', 'integration', 'mvsdk', 'flask', 'flask_cors', 'flask.json', 'flask.sansio', 'flask.sansio.app', 'flask.sansio.blueprints', 'flask.sansio.scaffold', 'jinja2', 'markupsafe', 'werkzeug', 'werkzeug.serving', 'werkzeug.debug', 'click', 'blinker', 'itsdangerous', 'cv2', 'numpy', 'scipy', 'scipy.ndimage', 'PIL', 'PIL.Image', 'psutil', 'dotenv', 'base64', 'ctypes', 'logging', 'logging.handlers', 'argparse', 'json', 'threading', 'platform', 'signal', 'math', 'io', 'datetime'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'pandas', 'test', 'unittest', 'xmlrpc', 'pydoc', 'doctest', 'torch', 'torchvision', 'torchaudio', 'tensorflow', 'tensorboard', 'keras', 'sklearn', 'scikit-learn', 'transformers', 'huggingface_hub', 'tokenizers', 'safetensors', 'accelerate', 'datasets', 'numexpr', 'numba', 'llvmlite', 'sympy', 'IPython', 'jupyter', 'notebook', 'sphinx', 'grpc', 'grpcio', 'google', 'google.protobuf', 'tensorstore', 'jax', 'jaxlib', 'pydantic'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='magicqc_core',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
