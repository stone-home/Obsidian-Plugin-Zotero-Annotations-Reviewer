import { TranslationClient } from './digest-translate';
import { DigestHttp, DigestHttpRequest, DigestHttpResponse } from './digest-types';

function fakeHttp(
	reply: (request: DigestHttpRequest) => Partial<DigestHttpResponse> | Error
) {
	const requests: DigestHttpRequest[] = [];
	const http: DigestHttp = async (request) => {
		requests.push(request);
		const result = reply(request);
		if (result instanceof Error) throw result;
		return { status: 200, text: '', headers: {}, ...result };
	};
	return { http, requests };
}

const PAPER = {
	key: '5385JXGT',
	version: 0,
	itemType: 'preprint',
	title: 'Attention Is All You Need',
	tags: [{ tag: 'Machine Learning (cs.LG)', type: 1 }],
};
const NOTE = { itemType: 'note', parentItem: '5385JXGT', note: '<h2>Other</h2>' };

describe('TranslationClient', () => {
	it('posts the identifier as plain text to /search', async () => {
		const { http, requests } = fakeHttp(() => ({ text: JSON.stringify([PAPER]) }));
		const client = new TranslationClient(http, () => ' https://ts.example.net/// ');

		await client.search('10.48550/arXiv.1706.03762');

		expect(requests[0]).toEqual({
			url: 'https://ts.example.net/search',
			method: 'POST',
			contentType: 'text/plain',
			headers: { 'Content-Type': 'text/plain' },
			body: '10.48550/arXiv.1706.03762',
		});
	});

	it('returns the first top-level item and skips child notes', async () => {
		const { http } = fakeHttp(() => ({ text: JSON.stringify([NOTE, PAPER]) }));
		const client = new TranslationClient(http, () => 'http://127.0.0.1:1969');

		expect(await client.search('x')).toEqual({ ok: true, item: PAPER });
	});

	it('reports nothing found for HTTP 501', async () => {
		const { http } = fakeHttp(() => ({
			status: 501,
			text: 'No items returned from any translator',
		}));
		const client = new TranslationClient(http, () => 'http://127.0.0.1:1969');

		expect(await client.search('10.9999/none')).toEqual({
			ok: false,
			reason: 'Lookup found nothing for 10.9999/none',
		});
	});

	it.each([
		[300, '{}', 'Lookup returned several candidates'],
		[500, 'boom', 'Lookup failed (HTTP 500) for id'],
		[200, 'not json', 'Lookup returned a response that is not JSON'],
		[200, '{"itemType":"preprint"}', 'Lookup found nothing for id'],
		[200, JSON.stringify([NOTE, null, 'text', {}]), 'Lookup found nothing for id'],
	])('reports HTTP %i with body %s', async (status, text, reason) => {
		const { http } = fakeHttp(() => ({ status, text }));
		const client = new TranslationClient(http, () => 'http://127.0.0.1:1969');

		expect(await client.search('id')).toEqual({ ok: false, reason });
	});

	it('marks the server unreachable when the request fails', async () => {
		const { http } = fakeHttp(() => new Error('ECONNREFUSED'));
		const client = new TranslationClient(http, () => 'http://127.0.0.1:1969');

		expect(await client.search('id')).toEqual({
			ok: false,
			unreachable: true,
			reason: 'Translation server not reachable: ECONNREFUSED',
		});
	});

	it('treats any HTTP answer as online and a failed request as offline', async () => {
		const up = fakeHttp(() => ({ status: 404 }));
		const down = fakeHttp(() => new Error('refused'));

		expect(
			await new TranslationClient(up.http, () => 'http://h:1969/').ping()
		).toBe(true);
		expect(up.requests[0]).toEqual({ url: 'http://h:1969/', method: 'GET' });
		expect(
			await new TranslationClient(down.http, () => 'http://h:1969').ping()
		).toBe(false);
	});

	it('reads the base URL on every call', async () => {
		let base = 'http://one';
		const { http, requests } = fakeHttp(() => ({ status: 404 }));
		const client = new TranslationClient(http, () => base);

		await client.ping();
		base = 'http://two';
		await client.ping();

		expect(requests.map((request) => request.url)).toEqual([
			'http://one/',
			'http://two/',
		]);
	});
});
