"use client"

/*
 * WebGL Fluid Simulation - React Component
 * Based on Pavel Dobryakov's WebGL-Fluid-Simulation (MIT License)
 * https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 *
 * Adapted for Osiris dashboard: purple/black theme, no GUI,
 * effects on mouse hover (no click required), ambient auto-splats.
 */

import { useEffect, useRef } from "react"

interface FluidBackgroundProps {
  className?: string
}

export function FluidBackground({ className }: FluidBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // ── Resize canvas FIRST (before any WebGL setup, matching original) ──
    function scaleByPixelRatio(input: number) {
      const pixelRatio = window.devicePixelRatio || 1
      return Math.floor(input * pixelRatio)
    }

    canvas.width = scaleByPixelRatio(canvas.clientWidth)
    canvas.height = scaleByPixelRatio(canvas.clientHeight)

    // ── Config (user-tuned settings) ──
    const config = {
      SIM_RESOLUTION: 256,
      DYE_RESOLUTION: 1024,
      DENSITY_DISSIPATION: 1.8,
      VELOCITY_DISSIPATION: 4,
      PRESSURE: 0.13,
      PRESSURE_ITERATIONS: 20,
      CURL: 0.04,
      SPLAT_RADIUS: 0.19,
      SPLAT_FORCE: 6000,
      SHADING: true,
      COLORFUL: true,
      COLOR_UPDATE_SPEED: 10,
      BLOOM: true,
      BLOOM_ITERATIONS: 8,
      BLOOM_RESOLUTION: 256,
      BLOOM_INTENSITY: 0.8,
      BLOOM_THRESHOLD: 0.6,
      BLOOM_SOFT_KNEE: 0.7,
      SUNRAYS: true,
      SUNRAYS_RESOLUTION: 196,
      SUNRAYS_WEIGHT: 1.0,
      BACK_COLOR: { r: 0, g: 0, b: 0 },
      TRANSPARENT: false,
    }

    // ── Pointer prototype ─────────────────────────────────────
    class Pointer {
      id = -1
      texcoordX = 0
      texcoordY = 0
      prevTexcoordX = 0
      prevTexcoordY = 0
      deltaX = 0
      deltaY = 0
      down = false
      moved = false
      color: { r: number; g: number; b: number } = { r: 30, g: 0, b: 30 }
    }

    const pointers: Pointer[] = [new Pointer()]
    const splatStack: number[] = []

    // ── WebGL Context ─────────────────────────────────────────
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
    let gl = canvas.getContext("webgl2", params) as WebGL2RenderingContext | null
    const isWebGL2 = !!gl
    if (!isWebGL2) {
      gl = (canvas.getContext("webgl", params) || canvas.getContext("experimental-webgl", params)) as WebGL2RenderingContext | null
    }
    if (!gl) return

    const g = gl! // alias to satisfy TS

    let halfFloat: any
    let supportLinearFiltering: any
    if (isWebGL2) {
      g.getExtension("EXT_color_buffer_float")
      supportLinearFiltering = g.getExtension("OES_texture_float_linear")
    } else {
      halfFloat = g.getExtension("OES_texture_half_float")
      supportLinearFiltering = g.getExtension("OES_texture_half_float_linear")
    }

    g.clearColor(0.0, 0.0, 0.0, 1.0)

    const halfFloatTexType = isWebGL2 ? (g as WebGL2RenderingContext).HALF_FLOAT : halfFloat?.HALF_FLOAT_OES

    type TexFormat = { internalFormat: number; format: number } | null

    function getSupportedFormat(internalFormat: number, format: number, type: number): TexFormat {
      if (!supportRenderTextureFormat(internalFormat, format, type)) {
        switch (internalFormat) {
          case (g as any).R16F:
            return getSupportedFormat((g as any).RG16F, (g as any).RG, type)
          case (g as any).RG16F:
            return getSupportedFormat((g as any).RGBA16F, g.RGBA, type)
          default:
            return null
        }
      }
      return { internalFormat, format }
    }

    function supportRenderTextureFormat(internalFormat: number, format: number, type: number) {
      const texture = g.createTexture()
      g.bindTexture(g.TEXTURE_2D, texture)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
      g.texImage2D(g.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null)
      const fbo = g.createFramebuffer()
      g.bindFramebuffer(g.FRAMEBUFFER, fbo)
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0)
      const status = g.checkFramebufferStatus(g.FRAMEBUFFER)
      return status === g.FRAMEBUFFER_COMPLETE
    }

    let formatRGBA: TexFormat, formatRG: TexFormat, formatR: TexFormat
    if (isWebGL2) {
      const g2 = g as WebGL2RenderingContext
      formatRGBA = getSupportedFormat(g2.RGBA16F, g2.RGBA, halfFloatTexType)
      formatRG = getSupportedFormat(g2.RG16F, g2.RG, halfFloatTexType)
      formatR = getSupportedFormat(g2.R16F, g2.RED, halfFloatTexType)
    } else {
      formatRGBA = getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType)
      formatRG = getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType)
      formatR = getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType)
    }

    if (!supportLinearFiltering) {
      config.DYE_RESOLUTION = 512
      config.SHADING = false
      config.BLOOM = false
      config.SUNRAYS = false
    }

    // ── Shader compilation ────────────────────────────────────
    function compileShader(type: number, source: string, keywords?: string[] | null) {
      source = addKeywords(source, keywords)
      const shader = g.createShader(type)!
      g.shaderSource(shader, source)
      g.compileShader(shader)
      if (!g.getShaderParameter(shader, g.COMPILE_STATUS))
        console.trace(g.getShaderInfoLog(shader))
      return shader
    }

    function addKeywords(source: string, keywords?: string[] | null) {
      if (!keywords) return source
      let keywordsString = ""
      keywords.forEach((keyword) => {
        keywordsString += "#define " + keyword + "\n"
      })
      return keywordsString + source
    }

    // ── Program / Material classes ────────────────────────────
    function createProgramFromShaders(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
      const program = g.createProgram()!
      g.attachShader(program, vertexShader)
      g.attachShader(program, fragmentShader)
      g.linkProgram(program)
      if (!g.getProgramParameter(program, g.LINK_STATUS))
        console.trace(g.getProgramInfoLog(program))
      return program
    }

    function getUniforms(program: WebGLProgram) {
      const uniforms: Record<string, WebGLUniformLocation | null> = {}
      const uniformCount = g.getProgramParameter(program, g.ACTIVE_UNIFORMS)
      for (let i = 0; i < uniformCount; i++) {
        const uniformName = g.getActiveUniform(program, i)!.name
        uniforms[uniformName] = g.getUniformLocation(program, uniformName)
      }
      return uniforms
    }

    class Material {
      vertexShader: WebGLShader
      fragmentShaderSource: string
      programs: Record<number, WebGLProgram> = {}
      activeProgram: WebGLProgram | null = null
      uniforms: Record<string, WebGLUniformLocation | null> = {}

      constructor(vertexShader: WebGLShader, fragmentShaderSource: string) {
        this.vertexShader = vertexShader
        this.fragmentShaderSource = fragmentShaderSource
      }

      setKeywords(keywords: string[]) {
        let hash = 0
        for (let i = 0; i < keywords.length; i++) hash += hashCode(keywords[i])
        let program = this.programs[hash]
        if (!program) {
          const fragmentShader = compileShader(g.FRAGMENT_SHADER, this.fragmentShaderSource, keywords)
          program = createProgramFromShaders(this.vertexShader, fragmentShader)
          this.programs[hash] = program
        }
        if (program === this.activeProgram) return
        this.uniforms = getUniforms(program)
        this.activeProgram = program
      }

      bind() {
        g.useProgram(this.activeProgram)
      }
    }

    class Program {
      uniforms: Record<string, WebGLUniformLocation | null>
      program: WebGLProgram

      constructor(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
        this.program = createProgramFromShaders(vertexShader, fragmentShader)
        this.uniforms = getUniforms(this.program)
      }

      bind() {
        g.useProgram(this.program)
      }
    }

    // ── Shaders ───────────────────────────────────────────────
    const baseVertexShader = compileShader(g.VERTEX_SHADER, `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `)

    const blurVertexShader = compileShader(g.VERTEX_SHADER, `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `)

    const blurShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      uniform sampler2D uTexture;
      void main () {
        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
        sum += texture2D(uTexture, vL) * 0.35294117;
        sum += texture2D(uTexture, vR) * 0.35294117;
        gl_FragColor = sum;
      }
    `)

    const copyShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      void main () { gl_FragColor = texture2D(uTexture, vUv); }
    `)

    const clearShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
    `)

    const colorShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec4 color;
      void main () { gl_FragColor = color; }
    `)

    const displayShaderSource = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      uniform sampler2D uBloom;
      uniform sampler2D uSunrays;
      uniform sampler2D uDithering;
      uniform vec2 ditherScale;
      uniform vec2 texelSize;
      vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0));
        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
      }
      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        #ifdef SHADING
          vec3 lc = texture2D(uTexture, vL).rgb;
          vec3 rc = texture2D(uTexture, vR).rgb;
          vec3 tc = texture2D(uTexture, vT).rgb;
          vec3 bc = texture2D(uTexture, vB).rgb;
          float dx = length(rc) - length(lc);
          float dy = length(tc) - length(bc);
          vec3 n = normalize(vec3(dx, dy, length(texelSize)));
          vec3 l = vec3(0.0, 0.0, 1.0);
          float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
          c *= diffuse;
        #endif
        #ifdef BLOOM
          vec3 bloom = texture2D(uBloom, vUv).rgb;
        #endif
        #ifdef SUNRAYS
          float sunrays = texture2D(uSunrays, vUv).r;
          c *= sunrays;
          #ifdef BLOOM
            bloom *= sunrays;
          #endif
        #endif
        #ifdef BLOOM
          float noise = texture2D(uDithering, vUv * ditherScale).r;
          noise = noise * 2.0 - 1.0;
          bloom += noise / 255.0;
          bloom = linearToGamma(bloom);
          c += bloom;
        #endif
        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
      }
    `

    const bloomPrefilterShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform vec3 curve;
      uniform float threshold;
      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 0.0);
      }
    `)

    const bloomBlurShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum;
      }
    `)

    const bloomFinalShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      uniform float intensity;
      void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum * intensity;
      }
    `)

    const sunraysMaskShader = compileShader(g.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main () {
        vec4 c = texture2D(uTexture, vUv);
        float br = max(c.r, max(c.g, c.b));
        c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
        gl_FragColor = c;
      }
    `)

    const sunraysShader = compileShader(g.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float weight;
      #define ITERATIONS 16
      void main () {
        float Density = 0.3;
        float Decay = 0.95;
        float Exposure = 0.7;
        vec2 coord = vUv;
        vec2 dir = vUv - 0.5;
        dir *= 1.0 / float(ITERATIONS) * Density;
        float illuminationDecay = 1.0;
        float color = texture2D(uTexture, vUv).a;
        for (int i = 0; i < ITERATIONS; i++) {
          coord -= dir;
          float col = texture2D(uTexture, coord).a;
          color += col * illuminationDecay * weight;
          illuminationDecay *= Decay;
        }
        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
      }
    `)

    const splatShader = compileShader(g.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `)

    const advectionShader = compileShader(
      g.FRAGMENT_SHADER,
      `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform vec2 dyeTexelSize;
      uniform float dt;
      uniform float dissipation;
      vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;
        vec2 iuv = floor(st);
        vec2 fuv = fract(st);
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
      }
      void main () {
        #ifdef MANUAL_FILTERING
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          vec4 result = texture2D(uSource, coord);
        #endif
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
      }
    `,
      supportLinearFiltering ? null : ["MANUAL_FILTERING"]
    )

    const divergenceShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `)

    const curlShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
      }
    `)

    const vorticityShader = compileShader(g.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;
      void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `)

    const pressureShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `)

    const gradientSubtractShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `)

    // ── Blit setup (fullscreen quad) ──────────────────────────
    const blit = (() => {
      g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer())
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), g.STATIC_DRAW)
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, g.createBuffer())
      g.bufferData(g.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), g.STATIC_DRAW)
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
      g.enableVertexAttribArray(0)

      return (target: any, clear = false) => {
        if (target == null) {
          g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight)
          g.bindFramebuffer(g.FRAMEBUFFER, null)
        } else {
          g.viewport(0, 0, target.width, target.height)
          g.bindFramebuffer(g.FRAMEBUFFER, target.fbo)
        }
        if (clear) {
          g.clearColor(0.0, 0.0, 0.0, 1.0)
          g.clear(g.COLOR_BUFFER_BIT)
        }
        g.drawElements(g.TRIANGLES, 6, g.UNSIGNED_SHORT, 0)
      }
    })()

    // ── Create programs ───────────────────────────────────────
    const blurProgram = new Program(blurVertexShader, blurShader)
    const copyProgram = new Program(baseVertexShader, copyShader)
    const clearProgram = new Program(baseVertexShader, clearShader)
    const colorProgram = new Program(baseVertexShader, colorShader)
    const bloomPrefilterProgram = new Program(baseVertexShader, bloomPrefilterShader)
    const bloomBlurProgram = new Program(baseVertexShader, bloomBlurShader)
    const bloomFinalProgram = new Program(baseVertexShader, bloomFinalShader)
    const sunraysMaskProgram = new Program(baseVertexShader, sunraysMaskShader)
    const sunraysProgram = new Program(baseVertexShader, sunraysShader)
    const splatProgram = new Program(baseVertexShader, splatShader)
    const advectionProgram = new Program(baseVertexShader, advectionShader)
    const divergenceProgram = new Program(baseVertexShader, divergenceShader)
    const curlProgram = new Program(baseVertexShader, curlShader)
    const vorticityProgram = new Program(baseVertexShader, vorticityShader)
    const pressureProgram = new Program(baseVertexShader, pressureShader)
    const gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader)
    const displayMaterial = new Material(baseVertexShader, displayShaderSource)

    // ── FBO helpers ───────────────────────────────────────────
    function createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      g.activeTexture(g.TEXTURE0)
      const texture = g.createTexture()!
      g.bindTexture(g.TEXTURE_2D, texture)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, param)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, param)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
      g.texImage2D(g.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)

      const fbo = g.createFramebuffer()!
      g.bindFramebuffer(g.FRAMEBUFFER, fbo)
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0)
      g.viewport(0, 0, w, h)
      g.clear(g.COLOR_BUFFER_BIT)

      const texelSizeX = 1.0 / w
      const texelSizeY = 1.0 / h

      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX,
        texelSizeY,
        attach(id: number) {
          g.activeTexture(g.TEXTURE0 + id)
          g.bindTexture(g.TEXTURE_2D, texture)
          return id
        },
      }
    }

    function createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      let fbo1 = createFBO(w, h, internalFormat, format, type, param)
      let fbo2 = createFBO(w, h, internalFormat, format, type, param)
      return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read() { return fbo1 },
        set read(value) { fbo1 = value },
        get write() { return fbo2 },
        set write(value) { fbo2 = value },
        swap() { const temp = fbo1; fbo1 = fbo2; fbo2 = temp },
      }
    }

    function resizeFBO(target: any, w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      const newFBO = createFBO(w, h, internalFormat, format, type, param)
      copyProgram.bind()
      g.uniform1i(copyProgram.uniforms.uTexture, target.attach(0))
      blit(newFBO)
      return newFBO
    }

    function resizeDoubleFBO(target: any, w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      if (target.width === w && target.height === h) return target
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param)
      target.write = createFBO(w, h, internalFormat, format, type, param)
      target.width = w
      target.height = h
      target.texelSizeX = 1.0 / w
      target.texelSizeY = 1.0 / h
      return target
    }

    // ── Dithering texture (load actual blue-noise image, matching original) ──
    function createTextureAsync(url: string) {
      const texture = g.createTexture()!
      g.bindTexture(g.TEXTURE_2D, texture)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.REPEAT)
      // Start with 1x1 white pixel (matching original)
      g.texImage2D(g.TEXTURE_2D, 0, g.RGB, 1, 1, 0, g.RGB, g.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]))

      const obj = {
        texture,
        width: 1,
        height: 1,
        attach(id: number) {
          g.activeTexture(g.TEXTURE0 + id)
          g.bindTexture(g.TEXTURE_2D, texture)
          return id
        },
      }

      const image = new Image()
      image.onload = () => {
        obj.width = image.width
        obj.height = image.height
        g.bindTexture(g.TEXTURE_2D, texture)
        g.texImage2D(g.TEXTURE_2D, 0, g.RGB, g.RGB, g.UNSIGNED_BYTE, image)
      }
      image.src = url

      return obj
    }

    const ditheringTexture = createTextureAsync("/LDR_LLL1_0.png")

    // ── Framebuffer initialization ────────────────────────────
    let dye: any, velocity: any, divergenceFBO: any, curlFBO: any, pressure: any
    let bloom: any, bloomFramebuffers: any[] = []
    let sunraysFBO: any, sunraysTemp: any

    function initFramebuffers() {
      const simRes = getResolution(config.SIM_RESOLUTION)
      const dyeRes = getResolution(config.DYE_RESOLUTION)
      const texType = halfFloatTexType
      const rgba = formatRGBA!
      const rg = formatRG!
      const r = formatR!
      const filtering = supportLinearFiltering ? g.LINEAR : g.NEAREST

      g.disable(g.BLEND)

      if (!dye)
        dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
      else
        dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)

      if (!velocity)
        velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
      else
        velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)

      divergenceFBO = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, g.NEAREST)
      curlFBO = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, g.NEAREST)
      pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, g.NEAREST)

      initBloomFramebuffers()
      initSunraysFramebuffers()
    }

    function initBloomFramebuffers() {
      const res = getResolution(config.BLOOM_RESOLUTION)
      const texType = halfFloatTexType
      const rgba = formatRGBA!
      const filtering = supportLinearFiltering ? g.LINEAR : g.NEAREST
      bloom = createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering)
      bloomFramebuffers.length = 0
      for (let i = 0; i < config.BLOOM_ITERATIONS; i++) {
        const width = res.width >> (i + 1)
        const height = res.height >> (i + 1)
        if (width < 2 || height < 2) break
        bloomFramebuffers.push(createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering))
      }
    }

    function initSunraysFramebuffers() {
      const res = getResolution(config.SUNRAYS_RESOLUTION)
      const texType = halfFloatTexType
      const r = formatR!
      const filtering = supportLinearFiltering ? g.LINEAR : g.NEAREST
      sunraysFBO = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering)
      sunraysTemp = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering)
    }

    // ── Update display keywords ───────────────────────────────
    function updateKeywords() {
      const displayKeywords: string[] = []
      if (config.SHADING) displayKeywords.push("SHADING")
      if (config.BLOOM) displayKeywords.push("BLOOM")
      if (config.SUNRAYS) displayKeywords.push("SUNRAYS")
      displayMaterial.setKeywords(displayKeywords)
    }

    updateKeywords()
    initFramebuffers()

    // ── Color generation (Osiris purple/black theme) ──────────
    function generateColor() {
      // Single Osiris purple (270°, matching Tailwind purple-500 #a855f7)
      const c = HSVtoRGB(270 / 360, 1.0, 1.0)
      c.r *= 0.024
      c.g *= 0.024
      c.b *= 0.024
      return c
    }

    function HSVtoRGB(h: number, s: number, v: number) {
      let r = 0, g2 = 0, b = 0
      const i = Math.floor(h * 6)
      const f = h * 6 - i
      const p = v * (1 - s)
      const q = v * (1 - f * s)
      const t = v * (1 - (1 - f) * s)
      switch (i % 6) {
        case 0: r = v; g2 = t; b = p; break
        case 1: r = q; g2 = v; b = p; break
        case 2: r = p; g2 = v; b = t; break
        case 3: r = p; g2 = q; b = v; break
        case 4: r = t; g2 = p; b = v; break
        case 5: r = v; g2 = p; b = q; break
      }
      return { r, g: g2, b }
    }

    function normalizeColor(input: { r: number; g: number; b: number }) {
      return { r: input.r / 255, g: input.g / 255, b: input.b / 255 }
    }

    // ── Splat functions ───────────────────────────────────────
    function splat(x: number, y: number, dx: number, dy: number, color: { r: number; g: number; b: number }) {
      splatProgram.bind()
      g.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0))
      g.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height)
      g.uniform2f(splatProgram.uniforms.point, x, y)
      g.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0)
      g.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0))
      blit(velocity.write)
      velocity.swap()

      g.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0))
      g.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b)
      blit(dye.write)
      dye.swap()
    }

    function multipleSplats(amount: number) {
      for (let i = 0; i < amount; i++) {
        const color = generateColor()
        color.r *= 10.0
        color.g *= 10.0
        color.b *= 10.0
        const x = Math.random()
        const y = Math.random()
        const dx = 1000 * (Math.random() - 0.5)
        const dy = 1000 * (Math.random() - 0.5)
        splat(x, y, dx, dy, color)
      }
    }

    function splatPointer(pointer: Pointer) {
      const dx = pointer.deltaX * config.SPLAT_FORCE
      const dy = pointer.deltaY * config.SPLAT_FORCE
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color)
    }

    function correctRadius(radius: number) {
      const aspectRatio = canvas.width / canvas.height
      if (aspectRatio > 1) radius *= aspectRatio
      return radius
    }

    // ── Simulation step ───────────────────────────────────────
    function step(dt: number) {
      g.disable(g.BLEND)

      curlProgram.bind()
      g.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0))
      blit(curlFBO)

      vorticityProgram.bind()
      g.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0))
      g.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1))
      g.uniform1f(vorticityProgram.uniforms.curl, config.CURL)
      g.uniform1f(vorticityProgram.uniforms.dt, dt)
      blit(velocity.write)
      velocity.swap()

      divergenceProgram.bind()
      g.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0))
      blit(divergenceFBO)

      clearProgram.bind()
      g.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0))
      g.uniform1f(clearProgram.uniforms.value, config.PRESSURE)
      blit(pressure.write)
      pressure.swap()

      pressureProgram.bind()
      g.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(pressureProgram.uniforms.uDivergence, divergenceFBO.attach(0))
      for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        g.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1))
        blit(pressure.write)
        pressure.swap()
      }

      gradientSubtractProgram.bind()
      g.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0))
      g.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1))
      blit(velocity.write)
      velocity.swap()

      advectionProgram.bind()
      g.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      if (!supportLinearFiltering)
        g.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY)
      const velocityId = velocity.read.attach(0)
      g.uniform1i(advectionProgram.uniforms.uVelocity, velocityId)
      g.uniform1i(advectionProgram.uniforms.uSource, velocityId)
      g.uniform1f(advectionProgram.uniforms.dt, dt)
      g.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION)
      blit(velocity.write)
      velocity.swap()

      if (!supportLinearFiltering)
        g.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY)
      g.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0))
      g.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1))
      g.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION)
      blit(dye.write)
      dye.swap()
    }

    // ── Render ────────────────────────────────────────────────
    function render(target: any) {
      if (config.BLOOM) applyBloom(dye.read, bloom)
      if (config.SUNRAYS) {
        applySunrays(dye.read, dye.write, sunraysFBO)
        blurFn(sunraysFBO, sunraysTemp, 1)
      }

      if (target == null || !config.TRANSPARENT) {
        g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
        g.enable(g.BLEND)
      } else {
        g.disable(g.BLEND)
      }

      if (!config.TRANSPARENT) drawColor(target, normalizeColor(config.BACK_COLOR))
      drawDisplay(target)
    }

    function drawColor(target: any, color: { r: number; g: number; b: number }) {
      colorProgram.bind()
      g.uniform4f(colorProgram.uniforms.color, color.r, color.g, color.b, 1)
      blit(target)
    }

    function drawDisplay(target: any) {
      const width = target == null ? g.drawingBufferWidth : target.width
      const height = target == null ? g.drawingBufferHeight : target.height

      displayMaterial.bind()
      if (config.SHADING) g.uniform2f(displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height)
      g.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0))
      if (config.BLOOM) {
        g.uniform1i(displayMaterial.uniforms.uBloom, bloom.attach(1))
        g.uniform1i(displayMaterial.uniforms.uDithering, ditheringTexture.attach(2))
        const scale = getTextureScale(ditheringTexture, width, height)
        g.uniform2f(displayMaterial.uniforms.ditherScale, scale.x, scale.y)
      }
      if (config.SUNRAYS) g.uniform1i(displayMaterial.uniforms.uSunrays, sunraysFBO.attach(3))
      blit(target)
    }

    function applyBloom(source: any, destination: any) {
      if (bloomFramebuffers.length < 2) return
      let last = destination
      g.disable(g.BLEND)
      bloomPrefilterProgram.bind()
      const knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001
      const curve0 = config.BLOOM_THRESHOLD - knee
      const curve1 = knee * 2
      const curve2 = 0.25 / knee
      g.uniform3f(bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2)
      g.uniform1f(bloomPrefilterProgram.uniforms.threshold, config.BLOOM_THRESHOLD)
      g.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0))
      blit(last)

      bloomBlurProgram.bind()
      for (let i = 0; i < bloomFramebuffers.length; i++) {
        const dest = bloomFramebuffers[i]
        g.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY)
        g.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0))
        blit(dest)
        last = dest
      }

      g.blendFunc(g.ONE, g.ONE)
      g.enable(g.BLEND)
      for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
        const baseTex = bloomFramebuffers[i]
        g.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY)
        g.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0))
        g.viewport(0, 0, baseTex.width, baseTex.height)
        blit(baseTex)
        last = baseTex
      }

      g.disable(g.BLEND)
      bloomFinalProgram.bind()
      g.uniform2f(bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY)
      g.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0))
      g.uniform1f(bloomFinalProgram.uniforms.intensity, config.BLOOM_INTENSITY)
      blit(destination)
    }

    function applySunrays(source: any, mask: any, destination: any) {
      g.disable(g.BLEND)
      sunraysMaskProgram.bind()
      g.uniform1i(sunraysMaskProgram.uniforms.uTexture, source.attach(0))
      blit(mask)
      sunraysProgram.bind()
      g.uniform1f(sunraysProgram.uniforms.weight, config.SUNRAYS_WEIGHT)
      g.uniform1i(sunraysProgram.uniforms.uTexture, mask.attach(0))
      blit(destination)
    }

    function blurFn(target: any, temp: any, iterations: number) {
      blurProgram.bind()
      for (let i = 0; i < iterations; i++) {
        g.uniform2f(blurProgram.uniforms.texelSize, target.texelSizeX, 0.0)
        g.uniform1i(blurProgram.uniforms.uTexture, target.attach(0))
        blit(temp)
        g.uniform2f(blurProgram.uniforms.texelSize, 0.0, target.texelSizeY)
        g.uniform1i(blurProgram.uniforms.uTexture, temp.attach(0))
        blit(target)
      }
    }

    // ── Utility functions ─────────────────────────────────────
    function getResolution(resolution: number) {
      let aspectRatio = g.drawingBufferWidth / g.drawingBufferHeight
      if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio
      const min = Math.round(resolution)
      const max = Math.round(resolution * aspectRatio)
      if (g.drawingBufferWidth > g.drawingBufferHeight) return { width: max, height: min }
      else return { width: min, height: max }
    }

    function getTextureScale(texture: any, width: number, height: number) {
      return { x: width / texture.width, y: height / texture.height }
    }

    function hashCode(s: string) {
      if (s.length === 0) return 0
      let hash = 0
      for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i)
        hash |= 0
      }
      return hash
    }

    function wrap(value: number, min: number, max: number) {
      const range = max - min
      if (range === 0) return min
      return ((value - min) % range) + min
    }

    function correctDeltaX(delta: number) {
      const aspectRatio = canvas.width / canvas.height
      if (aspectRatio < 1) delta *= aspectRatio
      return delta
    }

    function correctDeltaY(delta: number) {
      const aspectRatio = canvas.width / canvas.height
      if (aspectRatio > 1) delta /= aspectRatio
      return delta
    }

    function resizeCanvas() {
      const width = scaleByPixelRatio(canvas.clientWidth)
      const height = scaleByPixelRatio(canvas.clientHeight)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        return true
      }
      return false
    }

    // ── Input handling ────────────────────────────────────────
    function updatePointerDownData(pointer: Pointer, id: number, posX: number, posY: number) {
      pointer.id = id
      pointer.down = true
      pointer.moved = false
      pointer.texcoordX = posX / canvas.width
      pointer.texcoordY = 1.0 - posY / canvas.height
      pointer.prevTexcoordX = pointer.texcoordX
      pointer.prevTexcoordY = pointer.texcoordY
      pointer.deltaX = 0
      pointer.deltaY = 0
      pointer.color = generateColor()
    }

    function updatePointerMoveData(pointer: Pointer, posX: number, posY: number) {
      pointer.prevTexcoordX = pointer.texcoordX
      pointer.prevTexcoordY = pointer.texcoordY
      pointer.texcoordX = posX / canvas.width
      pointer.texcoordY = 1.0 - posY / canvas.height
      pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX)
      pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY)
      pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0
    }

    function updatePointerUpData(pointer: Pointer) {
      pointer.down = false
    }

    // Helper: get canvas-relative coordinates from a client event
    function getCanvasRelativePos(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
        inBounds: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
      }
    }

    // Mouse: window-level events so they work through z-index overlays
    // Always create splats on move (no click required), click adds a burst
    const onMouseDown = (e: MouseEvent) => {
      const { x, y, inBounds } = getCanvasRelativePos(e.clientX, e.clientY)
      if (!inBounds) return

      // Don't create burst splats when clicking UI elements
      const target = e.target as HTMLElement
      if (target.closest("[data-no-splat], aside, button, textarea, input, a")) return

      const posX = scaleByPixelRatio(x)
      const posY = scaleByPixelRatio(y)
      updatePointerDownData(pointers[0], -1, posX, posY)
      splatStack.push(Math.floor(Math.random() * 3) + 2)
    }

    const onMouseMove = (e: MouseEvent) => {
      const { x, y, inBounds } = getCanvasRelativePos(e.clientX, e.clientY)
      if (!inBounds) {
        if (pointers[0].down) updatePointerUpData(pointers[0])
        return
      }
      const posX = scaleByPixelRatio(x)
      const posY = scaleByPixelRatio(y)
      if (!pointers[0].down) {
        // Initialize pointer on first hover
        pointers[0].texcoordX = posX / canvas.width
        pointers[0].texcoordY = 1.0 - posY / canvas.height
        pointers[0].prevTexcoordX = pointers[0].texcoordX
        pointers[0].prevTexcoordY = pointers[0].texcoordY
        pointers[0].down = true
      }
      updatePointerMoveData(pointers[0], posX, posY)
    }

    const onMouseUp = () => {
      // Don't set down=false so hovering continues to create splats
    }

    // Touch: window-level events for the same reason
    const onTouchStart = (e: TouchEvent) => {
      const touches = e.touches
      if (!touches.length) return
      while (touches.length >= pointers.length) pointers.push(new Pointer())
      for (let i = 0; i < touches.length; i++) {
        const { x, y } = getCanvasRelativePos(touches[i].clientX, touches[i].clientY)
        const posX = scaleByPixelRatio(x)
        const posY = scaleByPixelRatio(y)
        updatePointerDownData(pointers[i + 1], touches[i].identifier, posX, posY)
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      const touches = e.touches
      for (let i = 0; i < touches.length; i++) {
        const pointer = pointers[i + 1]
        if (!pointer?.down) continue
        const { x, y } = getCanvasRelativePos(touches[i].clientX, touches[i].clientY)
        const posX = scaleByPixelRatio(x)
        const posY = scaleByPixelRatio(y)
        updatePointerMoveData(pointer, posX, posY)
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      const touches = e.changedTouches
      for (let i = 0; i < touches.length; i++) {
        const pointer = pointers.find((p) => p.id === touches[i].identifier)
        if (pointer) updatePointerUpData(pointer)
      }
    }

    window.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: true })
    window.addEventListener("touchend", onTouchEnd)

    // ── Main loop ─────────────────────────────────────────────
    let lastUpdateTime = Date.now()
    let colorUpdateTimer = 0.0
    let animFrame = 0

    function update() {
      const now = Date.now()
      let dt = (now - lastUpdateTime) / 1000
      dt = Math.min(dt, 0.016666)
      lastUpdateTime = now

      if (resizeCanvas()) initFramebuffers()

      // Update pointer colors
      if (config.COLORFUL) {
        colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED
        if (colorUpdateTimer >= 1) {
          colorUpdateTimer = wrap(colorUpdateTimer, 0, 1)
          pointers.forEach((p) => {
            p.color = generateColor()
          })
        }
      }

      // Apply pointer inputs
      if (splatStack.length > 0) multipleSplats(splatStack.pop()!)
      pointers.forEach((p) => {
        if (p.moved) {
          p.moved = false
          splatPointer(p)
        }
      })

      step(dt)
      render(null)
      animFrame = requestAnimationFrame(update)
    }

    // Canvas was already resized at the top before FBO init - just start the loop
    update()

    // ── Cleanup ───────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animFrame)
      window.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", onTouchEnd)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "all",
      }}
    />
  )
}
