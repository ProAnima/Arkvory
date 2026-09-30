import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipFile } from 'yazl';
import { setup, create, base } from './fixture.mjs';

test('package and file path downloads share ACL, Range and Bearer-only authentication', async (t) => {
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
  const headers = f.headers;
  const grouped = await f.app.inject({
    url: `${base}/packages?sort=version&direction=desc&groupBy=package`,
    headers: f.headers,
  });
  assert.equal(grouped.statusCode, 200, grouped.body);
  assert.deepEqual(grouped.json().groups[0].artifactIds, [id]);
  const downloaded = await f.app.inject({
    url: '/api/v1/repositories/releases/packages/content?group=tools&name=example&version=1.0.0',
    headers,
  });
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  assert.deepEqual(downloaded.rawPayload, bytes);
  const common = await f.app.inject({
    url: '/api/v1/repositories/releases/packages/content?group=TOOLS&name=example&version=1.0.0',
    headers: { ...headers, range: 'bytes=0-7' },
  });
  assert.equal(common.statusCode, 206, common.body);
  assert.deepEqual(common.rawPayload, bytes.subarray(0, 8));
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/repositories/releases/packages/content?group=tools&name=example&version=2.0.0',
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/repositories/releases/packages/content?name=example&version=1.0.0&purl=pkg:generic/example',
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/repositories/private/packages/content?group=tools&name=example&version=1.0.0',
        headers,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/repositories/releases/packages/content?group=tools&name=example',
        headers,
      })
    ).statusCode,
    200,
  );
  for (const authorization of [
    { 'x-apikey': f.headers.authorization.slice(7) },
    {
      authorization:
        'Basic ' + Buffer.from('api:' + f.headers.authorization.slice(7)).toString('base64'),
    },
  ])
    assert.equal(
      (
        await f.app.inject({
          url: '/api/v1/repositories/releases/packages/content?group=tools&name=example',
          headers: authorization,
        })
      ).statusCode,
      401,
    );
  await f.app.inject({
    method: 'PUT',
    url: `${base}/asset`,
    headers: f.headers,
    payload: { path: 'folder/example.upack', artifactId: id, expectedRevision: 0 },
  });
  const range = await f.app.inject({
    url: '/api/v1/repositories/releases/asset/content?path=folder%2Fexample.upack',
    headers: { ...f.headers, range: 'bytes=0-7' },
  });
  assert.equal(range.statusCode, 206);
  assert.deepEqual(range.rawPayload, bytes.subarray(0, 8));
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/repositories/releases/asset/content?path=folder%2Fmissing.upack',
        headers,
      })
    ).statusCode,
    404,
  );
});

test('exact and latest UPack downloads resolve beyond 1000 versions', async (t) => {
  const f = await setup(t);
  const zip = new ZipFile();
  zip.addBuffer(
    Buffer.from(JSON.stringify({ name: 'Example', group: 'Tools', version: '2.0.0' })),
    'upack.json',
  );
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
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
  await f.catalog.pool.query(
    `WITH source AS (SELECT i,gen_random_uuid() AS id FROM generate_series(0,1004) AS i),
     inserted AS (
       INSERT INTO arkvory_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at)
       SELECT id,'releases','named-test','seed-'||i,
              jsonb_build_object('name','seed-'||i||'.upack','size','0','sha256',$1::text,
                                 'labels',jsonb_build_array(),'metadata',jsonb_build_object()),
              0,'available',now() FROM source RETURNING id,idempotency_key
     )
     INSERT INTO arkvory_packages(repository,package_group,name,version,artifact_id,manifest)
     SELECT 'releases','Tools','Example','1.0.'||split_part(idempotency_key,'-',2),id,
            jsonb_build_object('group','Tools','name','Example',
                               'version','1.0.'||split_part(idempotency_key,'-',2))
     FROM inserted`,
    ['0'.repeat(64)],
  );
  const headers = f.headers;
  for (const url of [
    '/api/v1/repositories/releases/packages/content?group=TOOLS&name=EXAMPLE&version=2.0.0',
    '/api/v1/repositories/releases/packages/content?group=tools&name=example',
  ]) {
    const response = await f.app.inject({ url, headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.rawPayload, bytes);
  }
  const missing = await f.app.inject({
    url: '/api/v1/repositories/releases/packages/content?group=tools&name=example&version=3.0.0',
    headers,
  });
  assert.equal(missing.statusCode, 404, missing.body);
});
