'use strict';

import express from 'express';
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucket = storage.bucket('versatiles');
const app = express();
app.disable('x-powered-by');

app.get(/.*/, async (req, res) => {
	let path = ('' + req.path).trim().replace(/^\/+/gi, '');
	path = decodeURI(path);
	let prefix = 'files/' + path;

	try {

		if ((path.length === 0) || path.endsWith('/')) {
			await sendFileList(prefix, res);
		} else {
			await sendFile(prefix, req, res);
		}
		return;

	} catch (error) {
		console.error({ path, error });
		return res.status(500).type('text').send('Internal Server Error');
	}
})

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`listening on port ${PORT}`));



async function sendFile(prefix, req, res) {

	let file = bucket.file(prefix);

	if (!(await file.exists())[0]) {
		// try list view 
		return await sendFileList(prefix + '/', res);
	}

	let [metadata] = (await file.getMetadata());
	let { size, contentType, etag } = metadata;

	res.set('cache-control', 'public, max-age=' + (86400 * 7));
	res.set('accept-ranges', 'bytes');
	res.set('content-type', contentType || 'application/octet-stream');
	if (etag) res.set('etag', etag);

	let range = req.range();
	if (range) {
		// handle range requests
		let { start, end } = range[0];

		if ((start > end) || (end >= size)) {
			// handle invalid range requests
			res.status(416);
			res.set('content-range', `bytes */${size}`);
			res.end();
			return;
		}

		res.set('content-range', `bytes ${start}-${end}/${size}`);
		res.set('content-length', end - start + 1);
		//console.log(res);
		res.status(206);
		file.createReadStream({ start, end }).pipe(res);
	} else {
		// handle normal requests

		res.set('transfer-encoding', 'chunked');
		res.status(200);
		file.createReadStream().pipe(res);
	}
}

async function sendFileList(prefix, res) {
	let [files] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: 1000 });

	if (files.length === 0) {
		return res.status(404).type('text').send(`file not found`)
	}

	files = files.map(file => {
		let name = file.name;
		if (!name.startsWith(prefix)) return;
		name = name.slice(prefix.length);
		if (name.length === 0) return;

		if (name.endsWith('/')) {
			// handle folder
			if (name.slice(0, -1).includes('/')) return;
			return `<tr><td><a href="${name}">${name}</a></td><td></td><td></td><tr>`;
		} else {
			// handle file
			if (name.includes('/')) return;

			let size = parseInt(file.metadata.size, 10);
			size = Math.round(size / (1024 * 1024)) + ' MB';

			let date = file.metadata.timeCreated;
			date = date.slice(0, 10) + ' ' + date.slice(11, 19);

			return `<tr><td><a href="${name}">${name}</a></td><td>${size}</td><td>${date}</td><tr>`;
		}
	})
		.filter(f => f);
	let html = [
		'<html>',
		'<head>',
		'<style>',
		'body { font-family: sans-serif }',
		'table { border-spacing: 2px; }',
		'table th { border-bottom: 1px solid #aaa }',
		'table td:nth-child(2) { text-align: right; padding: 0 20px }',
		'</style>',
		'</head>',
		'<body>',
		'<table>',
		'<tr><th>filename</th><th>size</th><th>date</th></tr>',
		...files,
		'</table>',
		'</body>',
		'</html>',
	].join('\n');
	res.status(200).send(html);
}
