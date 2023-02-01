'use strict';

import express from 'express';
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucket = storage.bucket('versatiles');
const app = express();
app.disable('x-powered-by');

app.get('/healthcheck', (serverRequest, serverResponse) => {
	serverResponse
		.status(200)
		.type('text')
		.send('ok')
})

app.get(/.*/, async (req, res) => {
	let path = ('' + req.path).trim().replace(/^\/+/gi, '');
	path = decodeURI(path);
	try {
		let prefix = 'files/' + path;

		if (path === '') path = '/';

		if (path.endsWith('/')) {
			return await sendFileList();
		} else {
			return await sendFile();
		}

		async function sendFile() {
			let file = bucket.file(prefix);
			if (!(await file.exists())[0]) return sendError404()

			let [metadata] = (await file.getMetadata());
			let headers = {
				'cache-control': 'max-age=' + (86400 * 30),
			}

			if (metadata.contentType) headers['content-type'] = metadata.contentType;
			if (metadata.size) headers['content-length'] = metadata.size;
			if (metadata.etag) headers['etag'] = metadata.etag;

			file.createReadStream().pipe(res.status(200));
		}

		async function sendFileList() {
			let [files] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: 1000 });
			files = files.map(f => {
				let name = f.name;
				if (!name.startsWith(prefix)) return;
				name = name.slice(prefix.length);
				if (name.endsWith('/')) {
					// folder
					if (name.slice(0,-1).includes('/')) return;
					return `<a href="${name}">${name}</a><br>`;
				} else {
					// file
					if (name.includes('/')) return;
					return `<a href="${name}">${name}</a><br>`;
				}
			})
			.filter(f => f);
			let html = [
				'<html>',
				'<body>',
				...files,
				'</body>',
				'</html>',
			].join('\n');
			res.status(200).send(html);
		}

		function sendError404() {
			return res.status(404).type('text').send(`file not found`)
		}
	} catch (error) {
		console.error({ path, error });
		return res.status(500).type('text').send('Internal Server Error');
	}
})

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => console.log(`listening on port ${PORT}`));
