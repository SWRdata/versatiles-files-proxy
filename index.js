'use strict';

import express from 'express';
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucket = storage.bucket('versatiles');
const app = express();
app.disable('x-powered-by');

app.get(/.*/, async (req, res) => {
	let path = url2path(req.path);

	try {

		await sendFileList(path, res);
		return;

	} catch (error) {
		console.error({ path, error });
		return res.status(500).type('text').send('Internal Server Error');
	}
})

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`listening on port ${PORT}`));

async function sendFileList(path, res) {
	let [files] = await bucket.getFiles({ prefix: path, autoPaginate: false, maxResults: 10000 });

	if (files.length === 0) {
		return res.status(404).type('text').send(`file not found`)
	}

	let table = new Map();
	let url = path2url(path);
	if (url.length > 1) addLine(path2url(path.replace(/\/[^\/]*\/$/, '/')), '..');

	files.forEach(file => {
		let name = file.name;
		if (!name.startsWith(path)) return;
		name = name.slice(path.length);
		if (name.length === 0) return;
		let url = path2url(file.name);

		if (name.endsWith('/')) { // handle folder
			if (name.slice(0, -1).includes('/')) return; // ignore stuff in subfolders
			addLine(url, name);
		} else { // handle file
			if (name.includes('/')) {
				let suffix = name.replace(/^.*?\//, '');
				if (!url.endsWith(suffix)) return;
				addLine(url.slice(0, -suffix.length), name.slice(0, -suffix.length));
				return; // ignore stuff in subfolders
			}
			addLine('/download' + url, name, parseInt(file.metadata.size, 10), file.metadata.timeCreated);
		}
	});

	function addLine(url, name, size, date) {
		if (table.has(url)) return;

		size = (size === undefined) ? '' : Math.ceil(size / 1048576).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\'') + ' MB';
		date = (date === undefined) ? '' : date.slice(0, 10) + ' ' + date.slice(11, 19);
		let order = url;
		if (url.startsWith('.')) order = '0' + order;
		else if (url.endsWith('/')) order = '1' + order;
		else order = '2' + order;
		table.set(url, { order, html: `<tr><td><a href="${url}">${name}</a></td><td>${size}</td><td>${date}</td><tr>` });
	}

	table = Array.from(table.values()).sort((a, b) => a.order < b.order ? -1 : 1);
	table = table.map(e => e.html);

	let html = [
		'<html>',
		'<head>',
		'<style>',
		'body { font-family: sans-serif }',
		'table { border-collapse: collapse; margin: 100px auto 0 }',
		'table tr:nth-child(2) td { padding-top: 10px }',
		'table th { border-bottom: 1px solid #aaa }',
		'table td { padding: 3px 10px;  }',
		'table td:nth-child(1) { text-align: left; min-width: 200px }',
		'table td:nth-child(2) { text-align: right; min-width: 100px }',
		'table td:nth-child(3) { text-align: center; min-width: 160px }',
		'</style>',
		'</head>',
		'<body>',
		'<table>',
		'<tr><th>filename</th><th>size</th><th>date</th></tr>',
		...table,
		'</table>',
		'<div style="text-align:center; margin-top:200px">Kartendaten basieren auf OpenStreetMap<br>Bitte immer als Quelle angeben: "© OpenStreetMap-Mitwirkende"',
		'</div>',
		'</body>',
		'</html>',
	].join('\n');

	console.log('sendFileList: 200', path);
	res.set('cache-control', 'public, max-age=3600');
	res.set('content-type', 'text/html');
	res.status(200).send(html);
}

function url2path(url) {
	url = ('' + url).trim().replace(/^\/+/, '');
	url = decodeURI(url);
	return 'download/' + url;
}

function path2url(path) {
	path = ('' + path).trim().replace(/^\/+/, '');
	path = '/' + path.replace(/^download\//i, '');
	return path;
}
