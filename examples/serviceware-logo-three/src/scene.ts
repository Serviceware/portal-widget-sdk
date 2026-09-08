import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { LOGO_SVG } from './logo-svg';
import { LogoSettings, safeColor } from './schema';

type LogoMesh = THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshPhysicalMaterial>;

/** The model is scaled so its larger side is this many units; `depth` and bevels are in the same units. */
const MODEL_SIZE = 100;

/**
 * Extrudes the logo SVG into meshes and renders them into `container`.
 * The SVG is y-down; `flip` rotates it 180 degrees around X so it reads correctly,
 * and `spinner` carries the user rotation.
 */
export class LogoScene {
    frames = 0;

    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
    private readonly spinner = new THREE.Group();
    private readonly flip = new THREE.Group();
    private readonly environment: THREE.Texture;
    private meshes: LogoMesh[] = [];
    private logoSize = new THREE.Vector3(MODEL_SIZE, MODEL_SIZE, 12);
    private settings: LogoSettings;
    private width = 1;
    private height = 1;
    private running = false;
    private rafHandle = 0;
    private lastTime = 0;
    private dragging = false;
    private pointerX = 0;
    private pointerY = 0;

    constructor(
        private readonly container: HTMLElement,
        settings: LogoSettings
    ) {
        this.settings = settings;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.95;
        container.appendChild(this.renderer.domElement);

        // Image-based lighting gives the material soft reflections on the bevels; kept low so the
        // flat front face stays saturated instead of mirroring the bright room. The lights add shape.
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
        this.scene.environment = this.environment;
        this.scene.environmentIntensity = 0.35;

        const key = new THREE.DirectionalLight(0xffffff, 1.1);
        key.position.set(60, 90, 140);
        this.scene.add(key);
        const fill = new THREE.DirectionalLight(0xffffff, 0.35);
        fill.position.set(-70, 20, 100);
        this.scene.add(fill);
        const rim = new THREE.DirectionalLight(0xdbe9ff, 0.6);
        rim.position.set(-80, -30, -120);
        this.scene.add(rim);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.2));

        this.flip.rotation.x = Math.PI;
        this.spinner.add(this.flip);
        this.spinner.rotation.x = -0.15;
        this.scene.add(this.spinner);

        this.buildLogo();

        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', this.onPointerDown);
        canvas.addEventListener('pointermove', this.onPointerMove);
        canvas.addEventListener('pointerup', this.onPointerUp);
        canvas.addEventListener('pointercancel', this.onPointerUp);

        this.resize(container.clientWidth || 300, container.clientHeight || 150);
    }

    start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.lastTime = 0;
        this.rafHandle = requestAnimationFrame(this.tick);
    }

    stop(): void {
        this.running = false;
        cancelAnimationFrame(this.rafHandle);
    }

    resize(width: number, height: number): void {
        this.width = Math.max(1, Math.floor(width));
        this.height = Math.max(1, Math.floor(height));
        this.renderer.setSize(this.width, this.height, false);
        this.camera.aspect = this.width / this.height;
        this.fitCamera();
        if (!this.running) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    applySettings(next: LogoSettings): void {
        const rebuild = next.depth !== this.settings.depth;
        this.settings = next;
        if (rebuild) {
            this.buildLogo();
        } else {
            const color = new THREE.Color(safeColor(next.iconColor));
            for (const mesh of this.meshes) {
                mesh.material.color.copy(color);
                mesh.material.wireframe = next.wireframe;
            }
        }
        if (!this.running) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    dispose(): void {
        this.stop();
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('pointerdown', this.onPointerDown);
        canvas.removeEventListener('pointermove', this.onPointerMove);
        canvas.removeEventListener('pointerup', this.onPointerUp);
        canvas.removeEventListener('pointercancel', this.onPointerUp);
        this.disposeMeshes();
        this.environment.dispose();
        this.renderer.dispose();
        canvas.remove();
    }

    private buildLogo(): void {
        this.disposeMeshes();

        const depth = Math.min(80, Math.max(1, Number(this.settings.depth) || 12));
        const color = new THREE.Color(safeColor(this.settings.iconColor));
        const paths = new SVGLoader().parse(LOGO_SVG).paths;

        // Measure the flat outline first so depth and bevel can be expressed in normalised units.
        const shapesPerPath = paths.map(path => SVGLoader.createShapes(path)).filter(shapes => shapes.length > 0);
        const outline = new THREE.Box2();
        for (const shapes of shapesPerPath) {
            for (const shape of shapes) {
                for (const point of shape.getPoints(4)) {
                    outline.expandByPoint(point);
                }
            }
        }
        const outlineSize = outline.getSize(new THREE.Vector2());
        const scale = MODEL_SIZE / Math.max(outlineSize.x, outlineSize.y, 1);

        const bounds = new THREE.Box3();
        for (const shapes of shapesPerPath) {
            const material = new THREE.MeshPhysicalMaterial({
                color,
                metalness: 0.05,
                roughness: 0.5,
                clearcoat: 0.25,
                clearcoatRoughness: 0.4,
                wireframe: this.settings.wireframe
            });
            const geometry = new THREE.ExtrudeGeometry(shapes, {
                depth: depth / scale,
                bevelEnabled: true,
                bevelThickness: Math.min(2.5, depth / 5) / scale,
                bevelSize: Math.min(1.8, depth / 6) / scale,
                bevelSegments: 4,
                curveSegments: 12
            });
            geometry.scale(scale, scale, scale);
            geometry.computeBoundingBox();
            bounds.union(geometry.boundingBox as THREE.Box3);

            const mesh = new THREE.Mesh(geometry, material);
            this.flip.add(mesh);
            this.meshes.push(mesh);
        }

        const center = bounds.getCenter(new THREE.Vector3());
        for (const mesh of this.meshes) {
            mesh.geometry.translate(-center.x, -center.y, -center.z);
        }
        this.logoSize = bounds.getSize(new THREE.Vector3());
        this.fitCamera();
    }

    private disposeMeshes(): void {
        for (const mesh of this.meshes) {
            this.flip.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this.meshes = [];
    }

    private fitCamera(): void {
        const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
        // The model spins, so fit its diagonal rather than its front face.
        const radius = Math.hypot(this.logoSize.x, this.logoSize.z) / 2;
        const distanceForWidth = radius / (Math.tan(halfFov) * this.camera.aspect);
        const distanceForHeight = this.logoSize.y / 2 / Math.tan(halfFov);
        const distance = Math.max(distanceForWidth, distanceForHeight) * 1.12 + radius;
        this.camera.position.set(0, distance * 0.12, distance);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
    }

    private readonly tick = (now: number): void => {
        if (!this.running) {
            return;
        }
        const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.1) : 0;
        this.lastTime = now;
        if (this.settings.autoRotate && !this.dragging) {
            this.spinner.rotation.y += Number(this.settings.rotationSpeed) * dt;
        }
        this.renderer.render(this.scene, this.camera);
        this.frames += 1;
        this.rafHandle = requestAnimationFrame(this.tick);
    };

    private readonly onPointerDown = (event: PointerEvent): void => {
        this.dragging = true;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
        this.renderer.domElement.setPointerCapture(event.pointerId);
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (!this.dragging) {
            return;
        }
        const dx = event.clientX - this.pointerX;
        const dy = event.clientY - this.pointerY;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
        this.spinner.rotation.y += dx * 0.01;
        this.spinner.rotation.x = THREE.MathUtils.clamp(this.spinner.rotation.x + dy * 0.01, -1.2, 1.2);
        if (!this.running) {
            this.renderer.render(this.scene, this.camera);
        }
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        this.dragging = false;
        if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
            this.renderer.domElement.releasePointerCapture(event.pointerId);
        }
    };
}
