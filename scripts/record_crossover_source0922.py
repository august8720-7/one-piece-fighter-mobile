"""Record an observed official-web source and its exact local prompt, not generate art."""
from pathlib import Path
from datetime import date, datetime, timezone
import argparse
import hashlib
import json
import re
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'scripts/crossover_sources0922.json'


def record():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('key')
    p.add_argument('source')
    p.add_argument('prompt')
    p.add_argument('--reference', action='append', default=[])
    p.add_argument('--session', required=True, help='Actual correct-character conversation; no inherited old-session default')
    p.add_argument('--generated-date', default=datetime.now().astimezone().date().isoformat(),
                   help='Date of the observed completed generation (YYYY-MM-DD); defaults to today locally')
    p.add_argument('--text-model-label', required=True,
                   help='Exact model selector label observed in the official webpage; do not infer a backend variant')
    p.add_argument('--browser-label', choices=['Codex内置浏览器', 'Microsoft Edge'], required=True,
                   help='Browser that actually submitted and downloaded this generation')
    p.add_argument('--reasoning-effort', choices=['极高'], required=True,
                   help='Observed webpage reasoning level retained by the 0926 latest + extreme decision')
    args = p.parse_args()
    generated_date = date.fromisoformat(args.generated_date).isoformat()
    if not args.text_model_label.strip() or len(args.text_model_label) > 100 or '\n' in args.text_model_label or '\r' in args.text_model_label:
        raise ValueError('Provide the short, actually observed model selector label')
    if not re.fullmatch(r'https://chatgpt\.com/c/[A-Za-z0-9-]+', args.session):
        raise ValueError('An observed official generation conversation is required')
    if not re.fullmatch('[a-z][a-z0-9_]*', args.key):
        raise ValueError('Invalid source key')
    source, prompt = (ROOT / args.source).resolve(), (ROOT / args.prompt).resolve()
    if not source.is_relative_to(ROOT / 'public/assets/generated/source') or not prompt.is_relative_to(ROOT / 'docs/assets'):
        raise ValueError('Source or prompt outside approved directories')
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    Image.open(source).verify()
    im = Image.open(source)
    if im.format != 'PNG' or not prompt.read_text(encoding='utf-8').strip():
        raise ValueError('Original PNG and complete prompt required')
    catalog = json.loads(CATALOG.read_text(encoding='utf-8')) if CATALOG.exists() else {'schemaVersion': 1, 'sources': {}}
    if args.key in catalog['sources']:
        raise ValueError('Do not overwrite source receipts')
    references = {key: catalog['sources'][key]['sha256'] for key in args.reference}
    date_suffix = generated_date[5:7] + generated_date[8:10]
    proof = ROOT / f'docs/assets/{args.key}型号凭据{date_suffix}.txt'
    if proof.exists():
        raise FileExistsError('Preserve prior provenance')
    proof.write_text(f'{generated_date}，Asia/Shanghai。\n工具：{args.browser_label}。\n生成前实际核对入口：https://chatgpt.com/images/\n页面标题：ChatGPT 图像 2.5 | AI 图像生成器\n用户0926已接受官方网页“最新＋极高”。\n网页实际模型选项：{args.text_model_label}。\n网页实际思考强度：{args.reasoning_effort}，不作为图像型号依据。\n未显示的后台文字模型变体不作推断。\n生成会话：{args.session}\n原图：{args.source}\n原图SHA256：{sha(source)}\n提示词：{args.prompt}\n提示词SHA256：{sha(prompt)}\nPNG校验通过，尺寸：{im.width}x{im.height}。\n本记录日期是首次观察到结果已完成的本地日期；服务器实际生成日期/时刻未公开，跨日请求不据此猜测。\n当前为候选原画；PNG、型号证据不代替正常速度美术验收。\n', encoding='utf-8')
    catalog['sources'][args.key] = {
        'file': args.source, 'sha256': sha(source), 'model': 'GPT Image 2.5', 'provider': 'chatgpt-web',
        'sessionUrl': args.session, 'generatedAt': generated_date, 'generatedAtPrecision': 'first observed complete local day; actual generation timestamp not exposed', 'firstObservedCompletedDate': generated_date,
        'requestedTextModel': '最新 (0926 user-approved official UI label)', 'observedTextModelLabel': args.text_model_label,
        'browserLabel': args.browser_label,
        'observedReasoningEffort': args.reasoning_effort,
        'recordedAt': datetime.now(timezone.utc).isoformat(), 'unitScale': 1,
        'modelEvidence': {'file': str(proof.relative_to(ROOT)).replace('\\', '/'), 'sha256': sha(proof)},
        'prompt': {'file': args.prompt, 'sha256': sha(prompt)}, 'referenceSources': references,
    }
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'source': args.key, 'sha256': sha(source), 'size': im.size, 'recorded': True}))


if __name__ == '__main__':
    record()
