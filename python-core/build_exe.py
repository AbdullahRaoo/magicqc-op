"""
Build script — compile core_main.py into a single Windows executable.

Usage:
    cd python-core
    python build_exe.py

Output:
    python-core/dist/magicqc_core.exe
"""
import PyInstaller.__main__
import os
import shutil

SCRIPT = 'core_main.py'
EXE_NAME = 'magicqc_core'

# All local modules that PyInstaller can't auto-discover (lazy/conditional imports)
HIDDEN_IMPORTS = [
    # Local modules
    'worker_logger',
    'measurement_worker',
    'calibration_worker',
    'integration',
    'mvsdk',
    # Flask stack
    'flask',
    'flask_cors',
    'flask.json',
    'flask.sansio',
    'flask.sansio.app',
    'flask.sansio.blueprints',
    'flask.sansio.scaffold',
    'jinja2',
    'markupsafe',
    'werkzeug',
    'werkzeug.serving',
    'werkzeug.debug',
    'click',
    'blinker',
    'itsdangerous',
    # Scientific stack
    'cv2',
    'numpy',
    'scipy',
    'scipy.ndimage',
    'PIL',
    'PIL.Image',
    # Utilities
    'psutil',
    'dotenv',
    'base64',
    'ctypes',
    'logging',
    'logging.handlers',
    'argparse',
    'json',
    'threading',
    'platform',
    'signal',
    'math',
    'io',
    'datetime',
]

# Packages we don't need — excludes heavy Conda ML stack to keep exe lean
EXCLUDES = [
    'tkinter',
    'matplotlib',
    'pandas',
    'test',
    'unittest',
    'xmlrpc',
    'pydoc',
    'doctest',
    # Heavy ML packages from Conda base env (NOT used by MagicQC)
    'torch',
    'torchvision',
    'torchaudio',
    'tensorflow',
    'tensorboard',
    'keras',
    'sklearn',
    'scikit-learn',
    'transformers',
    'huggingface_hub',
    'tokenizers',
    'safetensors',
    'accelerate',
    'datasets',
    'numexpr',
    'numba',
    'llvmlite',
    'sympy',
    'IPython',
    'jupyter',
    'notebook',
    'sphinx',
    'grpc',
    'grpcio',
    'google',
    'google.protobuf',
    'tensorstore',
    'jax',
    'jaxlib',
    'pydantic',
]

def build():
    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(here)

    # Clean previous build artefacts
    for d in ('build', 'dist', f'{EXE_NAME}.spec'):
        target = os.path.join(here, d)
        if os.path.isdir(target):
            shutil.rmtree(target)
        elif os.path.isfile(target):
            os.remove(target)

    args = [
        SCRIPT,
        '--onefile',
        '--noconsole',
        f'--name={EXE_NAME}',
        f'--distpath={os.path.join(here, "dist")}',
        f'--workpath={os.path.join(here, "build")}',
        f'--specpath={here}',
    ]

    for mod in HIDDEN_IMPORTS:
        args.extend(['--hidden-import', mod])

    for pkg in EXCLUDES:
        args.extend(['--exclude-module', pkg])

    print(f'\n{"="*60}')
    print(f'  Building {EXE_NAME}.exe from {SCRIPT}')
    print(f'  Hidden imports: {len(HIDDEN_IMPORTS)}')
    print(f'  Excludes:       {len(EXCLUDES)}')
    print(f'{"="*60}\n')

    PyInstaller.__main__.run(args)

    exe_path = os.path.join(here, 'dist', f'{EXE_NAME}.exe')
    if os.path.isfile(exe_path):
        size_mb = os.path.getsize(exe_path) / (1024 * 1024)
        print(f'\n✅ Build successful: {exe_path}')
        print(f'   Size: {size_mb:.1f} MB')
    else:
        print(f'\n❌ Build failed — {exe_path} not found')
        raise SystemExit(1)


if __name__ == '__main__':
    build()
