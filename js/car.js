/* Minimal GLB reader for the car model (no external loader needed, works offline). */
window.makeCar = function (THREE, lengthBlocks) {
  const raw = atob(window.CAR_GLB), bin = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  const dv = new DataView(bin.buffer), jl = dv.getUint32(12, true);
  const J = JSON.parse(new TextDecoder().decode(bin.subarray(20, 20 + jl))), bo = 20 + jl + 8;
  const acc = i => {
    const a = J.accessors[i], v = J.bufferViews[a.bufferView], o = bo + (v.byteOffset || 0) + (a.byteOffset || 0);
    const n = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type], T = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : Uint16Array;
    return new T(bin.buffer.slice(o, o + a.count * n * T.BYTES_PER_ELEMENT));
  };
  const p = J.meshes[0].primitives[0], g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(acc(p.attributes.POSITION), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(acc(p.attributes.TEXCOORD_0), 2));
  g.setIndex(new THREE.BufferAttribute(acc(p.indices), 1));
  if (J.nodes[0].matrix) g.applyMatrix4(new THREE.Matrix4().fromArray(J.nodes[0].matrix));
  g.computeBoundingBox(); const bb = g.boundingBox, sz = new THREE.Vector3(); bb.getSize(sz);
  const k = (lengthBlocks || 6) / Math.max(sz.x, sz.z);
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); g.scale(k, k, k);
  const tex = new THREE.Texture(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.flipY = false;
  const iv = J.bufferViews[J.images[0].bufferView], o = bo + (iv.byteOffset || 0);
  const img = new Image(); img.onload = () => { tex.image = img; tex.needsUpdate = true; };
  img.src = URL.createObjectURL(new Blob([bin.subarray(o, o + iv.byteLength)], { type: J.images[0].mimeType }));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.12, side: THREE.DoubleSide }));
};
