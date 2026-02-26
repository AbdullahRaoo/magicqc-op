# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['core_main.py'],
    pathex=['D:\\work\\react\\operatorPannel-main\\python-core'],
    binaries=[],
    datas=[],
    hiddenimports=['worker_logger', 'measurement_worker', 'calibration_worker', 'integration', 'mvsdk', 'flask', 'flask_cors', 'flask.json', 'flask.sansio', 'flask.sansio.app', 'flask.sansio.blueprints', 'flask.sansio.scaffold', 'jinja2', 'markupsafe', 'werkzeug', 'werkzeug.serving', 'werkzeug.debug', 'click', 'blinker', 'itsdangerous', 'cv2', 'numpy', 'scipy', 'scipy.ndimage', 'PIL', 'PIL.Image', 'psutil', 'dotenv', 'base64', 'ctypes', 'logging', 'logging.handlers', 'argparse', 'json', 'threading', 'platform', 'signal', 'math', 'io', 'datetime'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # ── EXCLUDES ──
    # ONLY exclude large third-party packages and tkinter (needs Tcl/Tk runtime).
    # NEVER exclude stdlib modules (unittest, pydoc, doctest, xmlrpc, etc.) —
    # they are tiny (<50 KB each) and scipy/numpy import them transitively.
    # Excluding them causes ModuleNotFoundError crashes in production.
    excludes=[
        # GUI toolkit (requires Tcl/Tk binaries, not needed)
        'tkinter',
        # Large third-party packages we never use
        'matplotlib', 'pandas', 'pydantic',
        # ML / deep-learning frameworks
        'torch', 'torchvision', 'torchaudio',
        'tensorflow', 'tensorboard', 'keras',
        'sklearn', 'scikit-learn',
        'transformers', 'huggingface_hub', 'tokenizers',
        'safetensors', 'accelerate', 'datasets',
        # Numeric / symbolic extras
        'numexpr', 'numba', 'llvmlite', 'sympy',
        # Interactive / docs
        'IPython', 'jupyter', 'notebook', 'sphinx',
        # RPC / proto
        'grpc', 'grpcio', 'google', 'google.protobuf',
        # Other heavy packages
        'tensorstore', 'jax', 'jaxlib',
    ],
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
