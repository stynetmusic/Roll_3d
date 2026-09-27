/* Шкаф с роллетой. Three.js: ось Y вверх, правая система.
   Азимут 0 ставит камеру на +Z и смотрит на −Z: это фасад.
   С этого ракурса мировый +X — направо по экрану, правая направляющая стоит при x > 0.
   Единственное место, где азимут и полярный угол становятся координатами камеры — placeCamera. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.RollScene = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_VIEW = {
    azimuth: 0.62,
    polar: 1.22,
    radius: 4.2,
    target: [0, 0.98, 0],
  };

  function placeCamera(camera, target, azimuth, polar, radius) {
    const sinP = Math.sin(polar);
    camera.position.set(
      target.x + radius * sinP * Math.sin(azimuth),
      target.y + radius * Math.cos(polar),
      target.z + radius * sinP * Math.cos(azimuth)
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
  }

  /* Тянем модель за мышь: вправо уменьшает азимут, вниз уменьшает полярный угол. */
  function orbitBy(azimuth, polar, dx, dy) {
    let nextAzimuth = azimuth - dx * 0.005;
    let nextPolar = polar - dy * 0.005;
    const low = 0.2;
    const high = Math.PI - 0.2;
    if (nextPolar < low) nextPolar = low;
    if (nextPolar > high) nextPolar = high;
    return { azimuth: nextAzimuth, polar: nextPolar };
  }

  function zoomRadius(radius, deltaY) {
    let next = radius * Math.exp(deltaY * 0.001);
    if (next < 2.15) next = 2.15;
    if (next > 8) next = 8;
    return next;
  }

  function createCabinet(THREE) {
    const W = 0.9;
    const H = 2.06;
    const D = 0.58;
    const T = 0.018;
    const plinthH = 0.05;
    const frontZ = D / 2;
    const innerL = -W / 2 + T;
    const innerR = W / 2 - T;
    const innerBottom = plinthH + T;
    const innerTop = H - T;

    const boxH = 0.185;
    const boxD = 0.175;
    const boxBottomY = innerTop - boxH;
    const boxTopY = innerTop;
    const boxFront = frontZ + 0.02;
    const boxBack = boxFront - boxD;
    const boxMidZ = (boxFront + boxBack) / 2;
    const boxMidY = (boxBottomY + boxTopY) / 2;
    const boxL = innerL + 0.002;
    const boxR = innerR - 0.002;
    const boxW = boxR - boxL;

    const guideW = 0.036;
    const guideD = 0.03;
    const wall = 0.0045;
    const guideFront = frontZ + 0.008;
    const guideBack = guideFront - guideD;
    const guideMidZ = (guideFront + guideBack) / 2;
    const guideTop = boxBottomY + 0.012;
    const guideBottom = innerBottom;
    const guideH = guideTop - guideBottom;
    const guideMidY = (guideTop + guideBottom) / 2;

    function makeMat(color, roughness, metalness) {
      const material = new THREE.MeshStandardMaterial({
        color: color,
        roughness: roughness,
        metalness: metalness,
        emissive: 0x000000,
      });
      material.userData.baseColor = color;
      return material;
    }

    function addBox(parent, sx, sy, sz, x, y, z, material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    }

    function addCylinderX(parent, radius, length, x, y, z, material, segments) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, length, segments || 24),
        material
      );
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    }

    function tag(group, id) {
      group.name = id;
      group.userData.part = id;
      group.traverse(function (obj) {
        if (obj.isMesh) obj.userData.part = id;
      });
    }

    const root = new THREE.Group();
    root.name = "cabinet";

    const carcass = new THREE.Group();
    carcass.name = "carcass";
    const wood = makeMat(0x6a5b4e, 0.82, 0.02);
    const woodDark = makeMat(0x3a322c, 0.86, 0.02);
    const plinthMat = makeMat(0x2c2622, 0.9, 0.02);
    addBox(carcass, W + 0.02, plinthH, D + 0.02, 0, plinthH / 2, 0, plinthMat);
    const sideH = H - plinthH;
    const sideY = plinthH + sideH / 2;
    addBox(carcass, T, sideH, D, -W / 2 + T / 2, sideY, 0, wood);
    addBox(carcass, T, sideH, D, W / 2 - T / 2, sideY, 0, wood);
    addBox(carcass, W, T, D, 0, H - T / 2, 0, wood);
    addBox(carcass, W - 2 * T, T, D - 0.01, 0, plinthH + T / 2, 0, wood);
    const backH = H - plinthH - T;
    addBox(carcass, W - 2 * T, backH, T, 0, plinthH + backH / 2, -D / 2 + T / 2, woodDark);
    root.add(carcass);

    const parts = {};

    const boxMat = makeMat(0x8e97a2, 0.4, 0.42);
    const box = new THREE.Group();
    addBox(box, boxW, 0.004, boxD, 0, boxTopY - 0.002, boxMidZ, boxMat);
    addBox(box, boxW, boxH, 0.004, 0, boxMidY, boxBack + 0.002, boxMat);
    const hoodH = boxH * 0.28;
    addBox(box, boxW, hoodH, 0.004, 0, boxTopY - hoodH / 2, boxFront - 0.002, boxMat);
    tag(box, "box");
    parts.box = box;
    root.add(box);

    const coverMat = makeMat(0xd5dbe3, 0.38, 0.35);
    const covers = new THREE.Group();
    const coverT = 0.008;
    const coverH = boxH - 0.012;
    const coverD = boxD - 0.004;
    addBox(covers, coverT, coverH, coverD, boxL + coverT / 2, boxMidY, boxMidZ, coverMat);
    addBox(covers, coverT, coverH, coverD, boxR - coverT / 2, boxMidY, boxMidZ, coverMat);
    tag(covers, "covers");
    parts.covers = covers;
    root.add(covers);

    const shaftMat = makeMat(0xe7edf2, 0.32, 0.48);
    const shaft = new THREE.Group();
    const shaftR = 0.03;
    const shaftLen = boxW - 0.16;
    const shaftY = boxBottomY + 0.055;
    const shaftZ = boxMidZ;
    addCylinderX(shaft, shaftR, shaftLen, 0, shaftY, shaftZ, shaftMat, 28);
    addCylinderX(shaft, shaftR * 1.28, 0.012, -shaftLen / 2, shaftY, shaftZ, shaftMat, 24);
    addCylinderX(shaft, shaftR * 1.28, 0.012, shaftLen / 2, shaftY, shaftZ, shaftMat, 24);
    tag(shaft, "shaft");
    parts.shaft = shaft;
    root.add(shaft);

    const driveMat = makeMat(0x2a3038, 0.55, 0.25);
    const ringMat = makeMat(0xc9842a, 0.4, 0.35);
    const drive = new THREE.Group();
    const driveLen = 0.07;
    const driveR = 0.042;
    const driveX = boxR - coverT - driveLen / 2 - 0.012;
    addCylinderX(drive, driveR, driveLen, driveX, shaftY, shaftZ + 0.008, driveMat, 24);
    addCylinderX(drive, driveR + 0.006, 0.01, driveX + driveLen / 2 - 0.012, shaftY, shaftZ + 0.008, ringMat, 24);
    tag(drive, "drive");
    parts.drive = drive;
    root.add(drive);

    function buildGuide(side, material) {
      const group = new THREE.Group();
      const outerX = side < 0 ? innerL : innerR;
      const wallX = side < 0 ? outerX + wall / 2 : outerX - wall / 2;
      const lipCenterX = side < 0 ? outerX + guideW / 2 : outerX - guideW / 2;
      addBox(group, wall, guideH, guideD, wallX, guideMidY, guideMidZ, material);
      addBox(group, guideW - wall, guideH, wall, lipCenterX, guideMidY, guideFront - wall / 2, material);
      addBox(group, guideW - wall, guideH, wall, lipCenterX, guideMidY, guideBack + wall / 2, material);
      return group;
    }

    const guideLeft = buildGuide(-1, makeMat(0x6a727c, 0.45, 0.4));
    tag(guideLeft, "guide_left");
    parts.guide_left = guideLeft;
    root.add(guideLeft);

    const guideRight = buildGuide(1, makeMat(0x626a74, 0.45, 0.4));
    tag(guideRight, "guide_right");
    parts.guide_right = guideRight;
    root.add(guideRight);

    const slatL = innerL + guideW + 0.004;
    const slatR = innerR - guideW - 0.004;
    const slatW = slatR - slatL;
    const endH = 0.04;
    const endY = innerBottom + endH / 2;
    const endTop = endY + endH / 2;
    const slatTop = boxBottomY - 0.008;
    const slatPitch = 0.0162;
    const slatH = 0.0128;
    const slatZ = guideMidZ;
    const curtainMat = makeMat(0xc5cacf, 0.38, 0.4);
    const gapMat = makeMat(0x1a1d22, 0.8, 0.05);
    const curtain = new THREE.Group();
    const span = slatTop - endTop;
    addBox(curtain, slatW, Math.max(span, 0.05), 0.004, 0, (slatTop + endTop) / 2, slatZ - 0.012, gapMat);
    const slatGeo = new THREE.BoxGeometry(slatW, slatH, 0.009);
    let count = 0;
    for (let y = slatTop - slatH / 2; y - slatH / 2 >= endTop - 0.001; y -= slatPitch) {
      const slat = new THREE.Mesh(slatGeo, curtainMat);
      slat.position.set(0, y, slatZ);
      curtain.add(slat);
      count += 1;
      if (count > 120) break;
    }
    tag(curtain, "curtain");
    parts.curtain = curtain;
    root.add(curtain);

    const endMat = makeMat(0xf2f4f6, 0.34, 0.4);
    const rubber = makeMat(0x2a2e33, 0.9, 0.02);
    const endProfile = new THREE.Group();
    const endW = slatW + 0.004;
    addBox(endProfile, endW, endH, 0.02, 0, endY, slatZ, endMat);
    addBox(endProfile, endW, 0.006, 0.01, 0, endY - endH / 2 + 0.001, slatZ, rubber);
    tag(endProfile, "end_profile");
    parts.end_profile = endProfile;
    root.add(endProfile);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1.8, 48),
      new THREE.MeshBasicMaterial({ color: 0x0b0d10 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    ground.name = "ground";
    root.add(ground);

    return { root: root, parts: parts, ground: ground };
  }

  return {
    DEFAULT_VIEW: DEFAULT_VIEW,
    placeCamera: placeCamera,
    orbitBy: orbitBy,
    zoomRadius: zoomRadius,
    createCabinet: createCabinet,
  };
});
