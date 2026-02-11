"use client"

import { useEffect, useRef, useCallback } from "react"

// WebGL Navier-Stokes fluid simulation
// Adapted from Pavel Dobryakov's WebGL fluid simulation

interface FluidBackgroundProps {
  className?: string
}

export function FluidBackground({ className }: FluidBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)

  const init = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext("webgl", {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) return

    // Extensions
    const halfFloat = gl.getExtension("OES_texture_half_float")
    const halfFloatLinear = gl.getExtension("OES_texture_half_float_linear")
    const floatType = halfFloat ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE

    // Resize canvas
    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio, 1)
      canvas!.width = Math.floor(canvas!.clientWidth * dpr)
      canvas!.height = Math.floor(canvas!.clientHeight * dpr)
    }
    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)

    const SIM_W = 128
    const SIM_H = 128
    const DYE_W = 512
    const DYE_H = 512

    // Shader compilation
    function compileShader(type: number, source: string) {
      const shader = gl!.createShader(type)!
      gl!.shaderSource(shader, source)
      gl!.compileShader(shader)
      return shader
    }

    function createProgram(vs: string, fs: string) {
      const prog = gl!.createProgram()!
      gl!.attachShader(prog, compileShader(gl!.VERTEX_SHADER, vs))
      gl!.attachShader(prog, compileShader(gl!.FRAGMENT_SHADER, fs))
      gl!.linkProgram(prog)
      return prog
    }

    // Vertex shader (shared)
    const baseVS = `
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 texelSize;
      void main() {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `

    // Fragment shaders
    const splatFS = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main() {
        vec2 p = vUv - point;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `

    const advectionFS = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform float dt;
      uniform float dissipation;
      void main() {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = dissipation * texture2D(uSource, coord);
        gl_FragColor = result;
      }
    `

    const divergenceFS = `
      precision mediump float;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uVelocity;
      void main() {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `

    const pressureFS = `
      precision mediump float;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      void main() {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `

    const gradientSubtractFS = `
      precision mediump float;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      void main() {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `

    const displayFS = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main() {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a * 0.9);
      }
    `

    const clearFS = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      void main() {
        gl_FragColor = value * texture2D(uTexture, vUv);
      }
    `

    // Create programs
    const splatProg = createProgram(baseVS, splatFS)
    const advectionProg = createProgram(baseVS, advectionFS)
    const divergenceProg = createProgram(baseVS, divergenceFS)
    const pressureProg = createProgram(baseVS, pressureFS)
    const gradientProg = createProgram(baseVS, gradientSubtractFS)
    const displayProg = createProgram(baseVS, displayFS)
    const clearProg = createProgram(baseVS, clearFS)

    // Fullscreen quad
    const quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
    const quadIndexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIndexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)

    // Framebuffer helpers
    function createFBO(w: number, h: number) {
      const tex = gl!.createTexture()!
      gl!.bindTexture(gl!.TEXTURE_2D, tex)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, w, h, 0, gl!.RGBA, floatType, null)

      const fbo = gl!.createFramebuffer()!
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo)
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0)
      gl!.viewport(0, 0, w, h)
      gl!.clear(gl!.COLOR_BUFFER_BIT)

      return { texture: tex, fbo, width: w, height: h }
    }

    function createDoubleFBO(w: number, h: number) {
      let fbo1 = createFBO(w, h)
      let fbo2 = createFBO(w, h)
      return {
        get read() { return fbo1 },
        get write() { return fbo2 },
        swap() { const tmp = fbo1; fbo1 = fbo2; fbo2 = tmp },
      }
    }

    // Create simulation buffers
    const velocity = createDoubleFBO(SIM_W, SIM_H)
    const pressure = createDoubleFBO(SIM_W, SIM_H)
    const divergenceFBO = createFBO(SIM_W, SIM_H)
    const dye = createDoubleFBO(DYE_W, DYE_H)

    // Blit helper
    function blit(target: WebGLFramebuffer | null) {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, quadBuffer)
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, quadIndexBuffer)
      const posLoc = 0
      gl!.vertexAttribPointer(posLoc, 2, gl!.FLOAT, false, 0, 0)
      gl!.enableVertexAttribArray(posLoc)
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, target)
      gl!.drawElements(gl!.TRIANGLES, 6, gl!.UNSIGNED_SHORT, 0)
    }

    // Pointer state
    let pointerX = 0, pointerY = 0
    let lastPointerX = 0, lastPointerY = 0
    let pointerDown = false
    let splatStack: { x: number; y: number; dx: number; dy: number; color: [number, number, number] }[] = []

    function handlePointerMove(e: PointerEvent | MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      lastPointerX = pointerX
      lastPointerY = pointerY
      pointerX = (e.clientX - rect.left) / rect.width
      pointerY = 1.0 - (e.clientY - rect.top) / rect.height
      const dx = (pointerX - lastPointerX) * 30.0
      const dy = (pointerY - lastPointerY) * 30.0
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
        const hue = (Date.now() * 0.01) % 360
        const color = hslToRgb(hue, 0.7, 0.5)
        splatStack.push({ x: pointerX, y: pointerY, dx, dy, color })
      }
    }

    function handlePointerDown() { pointerDown = true }
    function handlePointerUp() { pointerDown = false }

    canvas.addEventListener("pointermove", handlePointerMove)
    canvas.addEventListener("mousemove", handlePointerMove)
    canvas.addEventListener("pointerdown", handlePointerDown)
    canvas.addEventListener("pointerup", handlePointerUp)

    function hslToRgb(h: number, s: number, l: number): [number, number, number] {
      h /= 360
      const a = s * Math.min(l, 1 - l)
      const f = (n: number) => {
        const k = (n + h * 12) % 12
        return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
      }
      return [f(0) * 0.3, f(8) * 0.3, f(4) * 0.3]
    }

    // Uniform helpers
    function use(prog: WebGLProgram) {
      gl!.useProgram(prog)
      // Bind position attribute
      const posLoc = gl!.getAttribLocation(prog, "aPosition")
      if (posLoc >= 0) {
        gl!.bindBuffer(gl!.ARRAY_BUFFER, quadBuffer)
        gl!.vertexAttribPointer(posLoc, 2, gl!.FLOAT, false, 0, 0)
        gl!.enableVertexAttribArray(posLoc)
      }
    }

    function setUniforms(prog: WebGLProgram, uniforms: Record<string, any>) {
      for (const [name, value] of Object.entries(uniforms)) {
        const loc = gl!.getUniformLocation(prog, name)
        if (loc === null) continue
        if (typeof value === "number") {
          gl!.uniform1f(loc, value)
        } else if (Array.isArray(value) && value.length === 2) {
          gl!.uniform2f(loc, value[0], value[1])
        } else if (Array.isArray(value) && value.length === 3) {
          gl!.uniform3f(loc, value[0], value[1], value[2])
        }
      }
    }

    function bindTexture(prog: WebGLProgram, name: string, tex: WebGLTexture, unit: number) {
      gl!.activeTexture(gl!.TEXTURE0 + unit)
      gl!.bindTexture(gl!.TEXTURE_2D, tex)
      gl!.uniform1i(gl!.getUniformLocation(prog, name), unit)
    }

    // Splat function
    function splat(x: number, y: number, dx: number, dy: number, color: [number, number, number]) {
      // Velocity splat
      use(splatProg)
      gl!.viewport(0, 0, SIM_W, SIM_H)
      bindTexture(splatProg, "uTarget", velocity.read.texture, 0)
      setUniforms(splatProg, {
        aspectRatio: canvas!.width / canvas!.height,
        point: [x, y],
        color: [dx, dy, 0],
        radius: 0.0001,
      })
      blit(velocity.write.fbo)
      velocity.swap()

      // Dye splat
      gl!.viewport(0, 0, DYE_W, DYE_H)
      bindTexture(splatProg, "uTarget", dye.read.texture, 0)
      setUniforms(splatProg, {
        color: [color[0], color[1], color[2]],
        radius: 0.0001,
      })
      blit(dye.write.fbo)
      dye.swap()
    }

    // Auto-splat timer for ambient motion
    let autoSplatTimer = 0

    // Main loop
    let lastTime = Date.now()
    function step() {
      const now = Date.now()
      let dt = Math.min((now - lastTime) / 1000, 0.016)
      lastTime = now

      // Process pointer splats
      while (splatStack.length > 0) {
        const s = splatStack.pop()!
        splat(s.x, s.y, s.dx, s.dy, s.color)
      }

      // Ambient auto-splats
      autoSplatTimer += dt
      if (autoSplatTimer > 2.0) {
        autoSplatTimer = 0
        const x = Math.random()
        const y = Math.random()
        const angle = Math.random() * Math.PI * 2
        const hue = Math.random() * 360
        splat(x, y, Math.cos(angle) * 2, Math.sin(angle) * 2, hslToRgb(hue, 0.6, 0.4))
      }

      // Advect velocity
      use(advectionProg)
      gl!.viewport(0, 0, SIM_W, SIM_H)
      bindTexture(advectionProg, "uVelocity", velocity.read.texture, 0)
      bindTexture(advectionProg, "uSource", velocity.read.texture, 1)
      setUniforms(advectionProg, {
        texelSize: [1.0 / SIM_W, 1.0 / SIM_H],
        dt,
        dissipation: 0.98,
      })
      blit(velocity.write.fbo)
      velocity.swap()

      // Advect dye
      gl!.viewport(0, 0, DYE_W, DYE_H)
      bindTexture(advectionProg, "uVelocity", velocity.read.texture, 0)
      bindTexture(advectionProg, "uSource", dye.read.texture, 1)
      setUniforms(advectionProg, {
        texelSize: [1.0 / DYE_W, 1.0 / DYE_H],
        dt,
        dissipation: 0.97,
      })
      blit(dye.write.fbo)
      dye.swap()

      // Divergence
      use(divergenceProg)
      gl!.viewport(0, 0, SIM_W, SIM_H)
      bindTexture(divergenceProg, "uVelocity", velocity.read.texture, 0)
      setUniforms(divergenceProg, {
        texelSize: [1.0 / SIM_W, 1.0 / SIM_H],
      })
      blit(divergenceFBO.fbo)

      // Clear pressure
      use(clearProg)
      bindTexture(clearProg, "uTexture", pressure.read.texture, 0)
      setUniforms(clearProg, { value: 0.8 })
      blit(pressure.write.fbo)
      pressure.swap()

      // Pressure solve (Jacobi iterations)
      use(pressureProg)
      setUniforms(pressureProg, {
        texelSize: [1.0 / SIM_W, 1.0 / SIM_H],
      })
      bindTexture(pressureProg, "uDivergence", divergenceFBO.texture, 1)
      for (let i = 0; i < 20; i++) {
        bindTexture(pressureProg, "uPressure", pressure.read.texture, 0)
        blit(pressure.write.fbo)
        pressure.swap()
      }

      // Gradient subtract
      use(gradientProg)
      bindTexture(gradientProg, "uPressure", pressure.read.texture, 0)
      bindTexture(gradientProg, "uVelocity", velocity.read.texture, 1)
      setUniforms(gradientProg, {
        texelSize: [1.0 / SIM_W, 1.0 / SIM_H],
      })
      blit(velocity.write.fbo)
      velocity.swap()

      // Display
      gl!.viewport(0, 0, canvas!.width, canvas!.height)
      use(displayProg)
      bindTexture(displayProg, "uTexture", dye.read.texture, 0)
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
      gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA)
      gl!.enable(gl!.BLEND)
      blit(null)
      gl!.disable(gl!.BLEND)

      animFrameRef.current = requestAnimationFrame(step)
    }

    // Initial random splats
    for (let i = 0; i < 5; i++) {
      const x = Math.random()
      const y = Math.random()
      const hue = Math.random() * 360
      splat(x, y, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, hslToRgb(hue, 0.7, 0.4))
    }

    step()

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener("resize", resizeCanvas)
      canvas.removeEventListener("pointermove", handlePointerMove)
      canvas.removeEventListener("mousemove", handlePointerMove)
      canvas.removeEventListener("pointerdown", handlePointerDown)
      canvas.removeEventListener("pointerup", handlePointerUp)
    }
  }, [])

  useEffect(() => {
    const cleanup = init()
    return cleanup
  }, [init])

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
