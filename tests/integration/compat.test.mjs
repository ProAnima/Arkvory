import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipFile } from 'yazl';
import { setup, create, base } from './fixture.mjs';

test('documented legacy original UPack and asset downloads share ACL and Range', async (t) => {
  const f = await setup(t);
  const zip = new ZipFile();
  zip.addBuffer(
    Buffer.from(JSON.stringify({ name: 'Example', group: 'Tools', version: '1.0.0' })),
    'upack.json',
  );
  zip.end();
  const chunks = [];
  for await (const c of zip.outputStream) chunks.push(c);
  const bytes = Buffer.concat(chunks);
  const id = (await create(f, bytes)).json().id;
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `${base}/uploads/${id}/content`,
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        payload: bytes,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/artifacts/${id}/package`,
        headers: f.headers,
      })
    ).statusCode,
    200,
  );
  const headers = { 'x-apikey': f.headers.authorization.slice(7) };
  const grouped = await f.app.inject({
    url: `${base}/packages?sort=version&direction=desc&groupBy=package`,
    headers: f.headers,
  });
  assert.equal(grouped.statusCode, 200, grouped.body);
  assert.deepEqual(grouped.json().groups[0].artifactIds, [id]);
  const downloaded = await f.app.inject({
    url: '/upack/releases/download/tools/example/1.0.0',
    headers,
  });
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  assert.deepEqual(downloaded.rawPayload, bytes);
  const common = await f.app.inject({
    url: '/api/packages/releases/download?group=TOOLS&name=example&version=1.0.0',
    headers: { ...headers, range: 'bytes=0-7' },
  });
  assert.equal(common.statusCode, 206, common.body);
  assert.deepEqual(common.rawPayload, bytes.subarray(0, 8));
  assert.equal(
    (
      await f.app.inject({
        url: '/api/packages/releases/download?group=tools&name=example&version=2.0.0',
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/packages/releases/download?name=example&version=1.0.0&purl=pkg:generic/example',
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/packages/private/download?group=tools&name=example&version=1.0.0',
        headers,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.app.inject({ url: '/upack/releases/download/tools/example?latest', headers }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/upack/releases/download/tools/example/1.0.0?contentOnly=zip',
        headers,
      })
    ).statusCode,
    400,
  );
  await f.app.inject({
    method: 'PUT',
    url: `${base}/asset`,
    headers: f.headers,
    payload: { path: 'folder/example.upack', artifactId: id, expectedRevision: 0 },
  });
  const range = await f.app.inject({
    url: '/endpoints/releases/content/folder/example.upack',
    headers: {
      authorization:
        'Basic ' + Buffer.from('api:' + f.headers.authorization.slice(7)).toString('base64'),
      range: 'bytes=0-7',
    },
  });
  assert.equal(range.statusCode, 206);
  assert.deepEqual(range.rawPayload, bytes.subarray(0, 8));
  assert.equal(
    (await f.app.inject({ url: '/upack/private/download/tools/example/1.0.0', headers }))
      .statusCode,
    403,
  );
});
